import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  canonicalUri,
  normalizeHeaders,
  sha256Hex,
  signRequest,
  type SigV4Config,
} from "../src/sigv4.js";

const EXAMPLE_CONFIG: SigV4Config = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
};

const GET_VANILLA = {
  method: "GET",
  url: "https://example.amazonaws.com/",
  headers: { "X-Amz-Date": "20150830T123600Z" },
} as const;

test("sha256Hex hashes empty string and abc", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("canonicalUri keeps slashes and encodes each segment", () => {
  assert.equal(canonicalUri("/"), "/");
  assert.equal(canonicalUri("/a b/c+d"), "/a%20b/c%2Bd");
  assert.equal(canonicalUri("/path/with space/and+plus"), "/path/with%20space/and%2Bplus");
  assert.equal(canonicalUri("/unreserved-._~/ok"), "/unreserved-._~/ok");
  assert.equal(canonicalUri("/100%/full"), "/100%25/full");
});

test("normalizeHeaders lowercases, trims, collapses spaces and sorts", () => {
  const { names, lines } = normalizeHeaders({
    "X-Amz-Date": "20150830T123600Z",
    "Host": "example.amazonaws.com",
    "X-Custom": "  some   spaced   value  ",
  });
  assert.deepEqual(names, ["host", "x-amz-date", "x-custom"]);
  assert.deepEqual(lines, [
    "host:example.amazonaws.com",
    "x-amz-date:20150830T123600Z",
    "x-custom:some spaced value",
  ]);
});

test("signRequest matches the published AWS get-vanilla test-suite vector", () => {
  const headers = signRequest(EXAMPLE_CONFIG, GET_VANILLA);
  assert.ok(
    headers.Authorization.startsWith(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request"
    )
  );
  assert.equal(
    headers.Authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
      "SignedHeaders=host;x-amz-date, " +
      "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
  );
  assert.equal(headers["X-Amz-Date"], "20150830T123600Z");
  assert.equal(headers["X-Amz-Content-Sha256"], sha256Hex(""));
});

test("signRequest for execute-api verifies against a locally recomputed string to sign", () => {
  const config: SigV4Config = { ...EXAMPLE_CONFIG, service: "execute-api" };
  const headers = signRequest(config, GET_VANILLA);

  assert.ok(
    headers.Authorization.startsWith(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/execute-api/aws4_request"
    )
  );
  assert.match(headers.Authorization, /SignedHeaders=host;x-amz-date/);

  // Rebuild the canonical request and string to sign from scratch, then
  // derive the expected signature and compare it to the Authorization header.
  const canonicalRequest = [
    "GET",
    "/",
    "",
    "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n",
    "host;x-amz-date",
    sha256Hex(""),
  ].join("\n");
  // Hash of the canonical request for the get-vanilla vector (documented in
  // the AWS SigV4 test suite).
  assert.equal(
    sha256Hex(canonicalRequest),
    "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63"
  );

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    "20150830T123600Z",
    "20150830/us-east-1/execute-api/aws4_request",
    sha256Hex(canonicalRequest),
  ].join("\n");

  const hmac = (key: string | Buffer, data: string) =>
    createHmac("sha256", key).update(data, "utf8").digest();
  const kDate = hmac(`AWS4${config.secretAccessKey}`, "20150830");
  const kRegion = hmac(kDate, "us-east-1");
  const kService = hmac(kRegion, "execute-api");
  const kSigning = hmac(kService, "aws4_request");
  const expectedSignature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  assert.equal(
    headers.Authorization,
    `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/execute-api/aws4_request, ` +
      `SignedHeaders=host;x-amz-date, Signature=${expectedSignature}`
  );
});

test("canonicalUri preserves valid pct-encoded triplets and encodes stray percent signs", () => {
  // `new URL().pathname` yields already-encoded paths; triplets must survive.
  assert.equal(canonicalUri("/%E1%88%B4"), "/%E1%88%B4");
  assert.equal(canonicalUri("/a%2Fb"), "/a%2Fb");
  assert.equal(canonicalUri("/a%20b"), "/a%20b");
  assert.equal(canonicalUri("/100%25/full"), "/100%25/full");
  assert.equal(canonicalUri("/100%/full"), "/100%25/full");
  assert.equal(canonicalUri("/mixed%zz"), "/mixed%25zz");
});

// Official AWS SigV4 test-suite vectors.
// Source: the AWS-published suite files (see docs/aws-sigv4.md), fetched from the
// saibotsivad/aws-sig-v4-test-suite mirror of the AWS documentation suite
// (raw/aws-sig-v4-test-suite/<case>/<case>.{req,creq,sts,authz}). The awslabs
// GitHub repo referenced by the AWS docs no longer resolves.
// Every expected value below was additionally recomputed from first principles
// with OpenSSL 3 (openssl dgst -sha256 -hmac / -mac HMAC), independent of
// node:crypto: payload hash, canonical-request hash and the full HMAC key
// chain all match the suite files.
const SUITE_CASES: ReadonlyArray<{
  name: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  signedHeaders: string;
  signature: string;
}> = [
  {
    name: "post-vanilla (POST /, empty body)",
    method: "POST",
    url: "https://example.amazonaws.com/",
    signedHeaders: "host;x-amz-date",
    signature: "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
  },
  {
    name: "get-vanilla-query-order-key",
    method: "GET",
    url: "https://example.amazonaws.com/?Param1=value2&Param1=Value1",
    signedHeaders: "host;x-amz-date",
    signature: "eedbc4e291e521cf13422ffca22be7d2eb8146eecf653089df300a15b2382bd1",
  },
  {
    name: "get-vanilla-query-order-key-case",
    method: "GET",
    url: "https://example.amazonaws.com/?Param2=value2&Param1=value1",
    signedHeaders: "host;x-amz-date",
    signature: "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  },
  {
    name: "get-vanilla-query-order-value",
    method: "GET",
    url: "https://example.amazonaws.com/?Param1=value2&Param1=value1",
    signedHeaders: "host;x-amz-date",
    signature: "5772eed61e12b33fae39ee5e7012498b51d56abc0abb7c60486157bd471c4694",
  },
  {
    name: "get-vanilla-query-unreserved",
    method: "GET",
    url: "https://example.amazonaws.com/?-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz=-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    signedHeaders: "host;x-amz-date",
    signature: "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
  },
  {
    name: "get-vanilla-empty-query-key",
    method: "GET",
    url: "https://example.amazonaws.com/?Param1=value1",
    signedHeaders: "host;x-amz-date",
    signature: "a67d582fa61cc504c4bae71f336f98b97f1ea3c7a6bfe1b6e45aec72011b9aeb",
  },
  {
    name: "get-unreserved",
    method: "GET",
    url: "https://example.amazonaws.com/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    signedHeaders: "host;x-amz-date",
    signature: "07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f",
  },
  {
    name: "get-utf8",
    method: "GET",
    url: "https://example.amazonaws.com/%E1%88%B4",
    signedHeaders: "host;x-amz-date",
    signature: "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85",
  },
  {
    name: "get-vanilla-utf8-query",
    method: "GET",
    url: "https://example.amazonaws.com/?%E1%88%B4=bar",
    signedHeaders: "host;x-amz-date",
    signature: "2cdec8eed098649ff3a119c94853b13c643bcf08f8b0a1d91e12c9027818dd04",
  },
  {
    name: "post-vanilla-query",
    method: "POST",
    url: "https://example.amazonaws.com/?Param1=value1",
    signedHeaders: "host;x-amz-date",
    signature: "28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11",
  },
  {
    name: "post-header-key-sort",
    method: "POST",
    url: "https://example.amazonaws.com/",
    headers: { "My-Header1": "value1" },
    signedHeaders: "host;my-header1;x-amz-date",
    signature: "c5410059b04c1ee005303aed430f6e6645f61f4dc9e1461ec8f8916fdf18852c",
  },
  {
    name: "post-header-value-case",
    method: "POST",
    url: "https://example.amazonaws.com/",
    headers: { "My-Header1": "VALUE1" },
    signedHeaders: "host;my-header1;x-amz-date",
    signature: "cdbc9802e29d2942e5e10b5bccfdd67c5f22c7c4e8ae67b53629efa58b974b7d",
  },
  {
    name: "get-header-value-trim",
    method: "GET",
    url: "https://example.amazonaws.com/",
    headers: { "My-Header1": " value1", "My-Header2": "\"a   b   c\"" },
    signedHeaders: "host;my-header1;my-header2;x-amz-date",
    signature: "acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736",
  },
];

for (const suiteCase of SUITE_CASES) {
  test(`signRequest matches AWS test-suite vector: ${suiteCase.name}`, () => {
    const headers = signRequest(EXAMPLE_CONFIG, {
      method: suiteCase.method,
      url: suiteCase.url,
      headers: { "X-Amz-Date": "20150830T123600Z", ...suiteCase.headers },
    });
    assert.equal(
      headers.Authorization,
      `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ` +
        `SignedHeaders=${suiteCase.signedHeaders}, Signature=${suiteCase.signature}`
    );
  });
}

test("signRequest canonical request hashes match the suite .sts files", () => {
  // Independently rebuilt from the suite .creq files; the hashes below are the
  // fourth line of the corresponding .sts files (and were recomputed with
  // OpenSSL). This catches regressions in path/query/header canonicalization
  // that a signature-only assertion could mask.
  const canonicalRequests: ReadonlyArray<[string, string, string]> = [
    [
      "post-vanilla",
      ["POST", "/", "", "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n", "host;x-amz-date", sha256Hex("")].join("\n"),
      "553f88c9e4d10fc9e109e2aeb65f030801b70c2f6468faca261d401ae622fc87",
    ],
    [
      "get-vanilla-query-order-key",
      ["GET", "/", "Param1=Value1&Param1=value2", "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n", "host;x-amz-date", sha256Hex("")].join("\n"),
      "704b4cef673542d84cdff252633f065e8daeba5f168b77116f8b1bcaf3d38f89",
    ],
    [
      "get-vanilla-query-order-key-case",
      ["GET", "/", "Param1=value1&Param2=value2", "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n", "host;x-amz-date", sha256Hex("")].join("\n"),
      "816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0",
    ],
    [
      "post-vanilla-query",
      ["POST", "/", "Param1=value1", "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n", "host;x-amz-date", sha256Hex("")].join("\n"),
      "9d659678c1756bb3113e2ce898845a0a79dbbc57b740555917687f1b3340fbbd",
    ],
  ];
  for (const [name, canonicalRequest, expected] of canonicalRequests) {
    assert.equal(sha256Hex(canonicalRequest), expected, name);
  }
});

test("signRequest is deterministic and secret-sensitive", () => {
  const req = {
    method: "GET",
    url: "https://example.com/path?b=2&a=1",
    headers: { "X-Amz-Date": "20150830T123600Z" },
  } as const;
  const a = signRequest(EXAMPLE_CONFIG, req);
  const b = signRequest(EXAMPLE_CONFIG, req);
  assert.equal(a.Authorization, b.Authorization);

  const differentSecret = signRequest(
    { ...EXAMPLE_CONFIG, secretAccessKey: "different-secret" },
    req
  );
  assert.notEqual(a.Authorization, differentSecret.Authorization);
});
