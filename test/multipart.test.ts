import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundary,
  buildMultipartBody,
  parseMultipartFields,
} from "../src/multipart.js";

test("buildMultipartBody produces a body containing the boundary and both part types", () => {
  const { body, contentType } = buildMultipartBody(
    { description: "hello", count: 3, active: true },
    [
      {
        name: "upload",
        filename: "file.txt",
        contentType: "text/plain",
        data: "file-contents",
      },
    ],
  );

  const match = contentType.match(/^multipart\/form-data; boundary=(.+)$/);
  assert.ok(match, "contentType should carry the boundary");
  const b = match![1];
  assert.ok(body.includes(Buffer.from(b, "utf8")));

  const text = body.toString("utf8");
  assert.ok(text.includes(`Content-Disposition: form-data; name="description"`));
  assert.ok(text.includes("hello"));
  assert.ok(text.includes(`Content-Disposition: form-data; name="count"`));
  assert.ok(text.includes("3"));
  assert.ok(text.includes(`Content-Disposition: form-data; name="active"`));
  assert.ok(text.includes("true"));
  assert.ok(
    text.includes(
      `Content-Disposition: form-data; name="upload"; filename="file.txt"`,
    ),
  );
  assert.ok(text.includes("Content-Type: text/plain"));
  assert.ok(text.includes("file-contents"));
  assert.ok(text.trimEnd().endsWith(`--${b}--`));
});

test("buildMultipartBody defaults file content type to application/octet-stream", () => {
  const { body } = buildMultipartBody({}, [
    { name: "blob", filename: "a.bin", data: Buffer.from([1, 2, 3]) },
  ]);
  assert.ok(body.toString("utf8").includes("Content-Type: application/octet-stream"));
});

test("buildMultipartBody works with no files and encodes unicode fields as UTF-8", () => {
  const { body } = buildMultipartBody({ greeting: "héllo ✓" });
  assert.ok(body.includes(Buffer.from("héllo ✓", "utf8")));
});

test("boundary returns unique random boundaries", () => {
  const a = boundary();
  const b = boundary();
  assert.notEqual(a, b);
  assert.ok(a.length > 8);
});

test("parseMultipartFields splits binary from regular properties", () => {
  const schema = {
    type: "object",
    properties: {
      description: { type: "string" },
      count: { type: "integer" },
      upload: { type: "string", format: "binary" },
      attachment: { format: "binary" },
      flag: { type: "boolean" },
    },
  };
  const result = parseMultipartFields(schema);
  assert.deepEqual(result, {
    fields: ["description", "count", "flag"],
    files: ["upload", "attachment"],
  });
});

test("parseMultipartFields returns undefined for non-object or propertyless schemas", () => {
  assert.equal(parseMultipartFields(undefined), undefined);
  assert.equal(parseMultipartFields(null), undefined);
  assert.equal(parseMultipartFields({ type: "string" }), undefined);
  assert.equal(parseMultipartFields({ type: "object" }), undefined);
});
