# AWS SigV4 signing — verification notes

`src/sigv4.ts` implements AWS Signature Version 4 request signing
(`sha256` payload hashing, RFC 3986 canonicalization, HMAC key chain,
`AWS4-HMAC-SHA256` authorization header). This document records what has been
verified, how, and what remains unverified. It is not a usage guide.

## What was verified, and how

### Official AWS SigV4 test suite vectors (2026-11-16)

The AWS documentation references an official test suite
(`signature-v4-test-suite`). The `awslabs/aws-sig-v4-test-suite` GitHub repo
no longer resolves; the suite files were fetched from the
`saibotsivad/aws-sig-v4-test-suite` mirror, which states the files are "the
test suite files found in the AWS documentation":

```
https://raw.githubusercontent.com/saibotsivad/aws-sig-v4-test-suite/master/raw/aws-sig-v4-test-suite/<case>/<case>.{req,creq,sreq,sts,authz}
```

The following vectors are asserted in `test/sigv4.test.ts` using the
well-known example configuration (`AKIDEXAMPLE` /
`wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY`, region `us-east-1`, service
`service`, `X-Amz-Date: 20150830T123600Z`):

- `get-vanilla` (pre-existing)
- `post-vanilla`, `post-vanilla-query`, `post-header-key-sort`,
  `post-header-value-case`
- `get-vanilla-query-order-key`, `get-vanilla-query-order-key-case`,
  `get-vanilla-query-order-value`, `get-vanilla-query-unreserved`,
  `get-vanilla-empty-query-key`, `get-unreserved`, `get-utf8`,
  `get-vanilla-utf8-query`, `get-header-value-trim`

For each of the 14 hardcoded vectors, the expected signature **and** the
expected canonical-request SHA-256 (the `.sts` third line / `.creq` hash) were
recomputed from first principles with OpenSSL 3.5 (`openssl dgst -sha256
-hmac` for the outer key and `-mac HMAC -macopt hexkey:` for the binary
intermediate keys), independent of `node:crypto`. All 14 match both the suite
files and the implementation. The `.creq` payload hash used throughout is
`e3b0c442…` (empty body), itself verified with `printf '' | openssl dgst -sha256`.

### Previously latent bug found by the suite: UTF-8 path double-encoding

The suite case `get-utf8` (`GET /ሴ`) failed before the fix: `new URL()`
yields an already-percent-encoded pathname (`/%E1%88%B4`), and
`canonicalUri()` re-encoded `%` to `%25`. `canonicalUri` now preserves valid
pct-encoded triplets while still encoding stray `%` and all other
non-unreserved characters. This also preserves literal `%2F` (an encoded
slash inside a path segment), which the old code would have corrupted as
well. All pre-existing `canonicalUri` tests still pass unchanged.

### Not verified / known limitations

- **No live AWS calls.** End-to-end acceptance against a real AWS endpoint
  (execute-api, IAM, etc.) requires real credentials and was not performed.
  Unit-level agreement with the official suite is the strongest available
  local signal.
- **STS presigned-URL and `normalize-path` suite cases are not covered.**
  The suite files for `post-x-www-form-urlencoded*` disagree with each other
  (`.sreq` vs `.authz` list different `SignedHeaders`), and the module does
  not implement presigned URLs; these were deliberately skipped rather than
  force-fitted.
- **Query strings with a raw `+`** are decoded as space by `URLSearchParams`
  (WHATWG behavior), which would canonicalize `?a=b+c` as `a=b%20c` rather
  than `a=b%2Bc`. No suite case covers this; callers should pass
  already-encoded query strings (as `URL` requires for correct semantics).
- The module intentionally excludes `x-amz-content-sha256` from the signed
  header set, matching the canonical AWS documentation example. The suite
  agrees for all covered cases.

### Reproducing the OpenSSL cross-check

A scratch script (not committed) recomputed the 14 vectors with Git's
`openssl.exe` (`C:\Program Files\Git\usr\bin\openssl.exe`) on Windows, e.g.:

```sh
printf '' | openssl dgst -sha256                                   # payload hash
printf 'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n<payload-hash>' > creq
openssl dgst -sha256 creq                                          # canonical-request hash
kDate=$(printf '20150830' | openssl dgst -sha256 -hmac "AWS4${SECRET}" -binary | xxd -p -c 256)
kRegion=$(printf 'us-east-1' | openssl dgst -sha256 -mac HMAC -macopt hexkey:$kDate -binary | xxd -p -c 256)
kService=$(printf 'service'   | openssl dgst -sha256 -mac HMAC -macopt hexkey:$kRegion -binary | xxd -p -c 256)
kSigning=$(printf 'aws4_request' | openssl dgst -sha256 -mac HMAC -macopt hexkey:$kService -binary | xxd -p -c 256)
printf 'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n<creq-hash>' \
  | openssl dgst -sha256 -mac HMAC -macopt hexkey:$kSigning        # signature
```

### Reference

- SigV4 overview and test-suite reference (AWS docs):
  `https://docs.aws.amazon.com/general/latest/gr/signature-v4-test-suite.html`
  and `https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html`
- Suite files used: `saibotsivad/aws-sig-v4-test-suite` (mirror), paths as
  listed above. The original `awslabs/aws-sig-v4-test-suite` repo returns
  404 as of 2026-11-16.
