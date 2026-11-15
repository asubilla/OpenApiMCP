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
