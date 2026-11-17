import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProto,
  listServices,
  grpcTools,
  formatGrpcTools,
  type ProtoPackage,
} from "../src/grpc.js";

const SIMPLE_PROTO = `
syntax = "proto3";

package shop.v1;

message GetItemRequest {
  string id = 1;
}

message GetItemResponse {
  string id = 1;
  int32 price = 2;
}

service ItemService {
  rpc GetItem(GetItemRequest) returns (GetItemResponse) {}
}
`;

const REAL_ISH_PROTO = `
// Public API for the library.
syntax = "proto3";

package library.v1;

// A book available in the catalog.
message Book {
  string title = 1; // inline comment after field
  int32 pages = 2;
  Author author = 3;
  repeated string tags = 4;
  map<string, int32> ratings = 5;
}

message Author {
  string name = 1;
  message Contact { // nested message
    string email = 1;
    string phone = 2;
  }
  Contact contact = 2;
}

message GetBookRequest {
  string id = 1;
  bool verbose = 2;
}

message GetBookResponse {
  Book book = 1;
}

message ListBooksRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message ListBooksResponse {
  repeated Book books = 1;
}

/* block comment service doc */
service BookService {
  // Fetch a single book by id.
  rpc GetBook(GetBookRequest) returns (GetBookResponse) {}
  rpc ListBooks(ListBooksRequest) returns (stream ListBooksResponse); // server streaming
  rpc UploadBooks(stream ListBooksRequest) returns (ListBooksResponse) { // client streaming
    option (google.api.http) = { post: "/v1/books" body: "*" };
  }
  rpc GetContact(Author.Contact) returns (Author.Contact); // nested input type
}
`;

test("parse simple proto", () => {
  const packages = parseProto(SIMPLE_PROTO);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].name, "shop.v1");
  assert.equal(packages[0].services.length, 1);
  const svc = packages[0].services[0];
  assert.equal(svc.name, "ItemService");
  assert.equal(svc.methods.length, 1);
  assert.deepEqual(svc.methods[0], {
    name: "GetItem",
    inputType: "GetItemRequest",
    outputType: "GetItemResponse",
    serverStreaming: false,
    clientStreaming: false,
  });
});

test("parse with comments, nested messages and streaming markers", () => {
  const packages = parseProto(REAL_ISH_PROTO);
  assert.equal(packages.length, 1);
  const svc = packages[0].services[0];
  assert.equal(svc.name, "BookService");
  assert.equal(svc.methods.length, 4);

  const byName = new Map(svc.methods.map((m) => [m.name, m]));
  assert.equal(byName.get("GetBook")?.serverStreaming, false);
  assert.equal(byName.get("GetBook")?.clientStreaming, false);
  assert.equal(byName.get("ListBooks")?.serverStreaming, true);
  assert.equal(byName.get("ListBooks")?.clientStreaming, false);
  assert.equal(byName.get("UploadBooks")?.serverStreaming, false);
  assert.equal(byName.get("UploadBooks")?.clientStreaming, true);
  assert.equal(byName.get("GetContact")?.inputType, "Author.Contact");
});

test("nested messages do not leak into the parent field list", () => {
  const packages = parseProto(REAL_ISH_PROTO);
  const tools = grpcTools(packages);
  const getBook = tools.find((t) => t.path.endsWith("/GetBook"));
  assert.ok(getBook);
  assert.deepEqual(
    getBook.params.map((p) => [p.argName, p.type]),
    [
      ["id", "string"],
      ["verbose", "bool"],
    ],
  );
});

test("listServices counts methods per service", () => {
  const packages = parseProto(REAL_ISH_PROTO);
  assert.deepEqual(listServices(packages), [
    { package: "library.v1", service: "BookService", methods: 4 },
  ]);

  const two = `
package a.v1;
service Alpha {
  rpc One(R) returns (R);
  rpc Two(R) returns (R);
}
package b.v2;
message R { string x = 1; }
service Beta {
  rpc Three(R) returns (R);
}
`;
  assert.deepEqual(listServices(parseProto(two)), [
    { package: "a.v1", service: "Alpha", methods: 2 },
    { package: "b.v2", service: "Beta", methods: 1 },
  ]);
});

test("grpcTools name, path, method and params", () => {
  const packages = parseProto(REAL_ISH_PROTO);
  const tools = grpcTools(packages);
  const getBook = tools.find((t) => t.path === "/library.v1.BookService/GetBook");
  assert.ok(getBook);
  assert.equal(getBook.name, "book_service_get_book");
  assert.equal(getBook.method, "POST");
  assert.equal(getBook.description.includes("BookService"), true);
  assert.equal(getBook.params.length, 2);
  for (const p of getBook.params) {
    assert.equal(p.location, "body");
    assert.equal(p.required, false);
  }
  assert.deepEqual(
    getBook.params.map((p) => p.type),
    ["string", "bool"],
  );

  const listBooks = tools.find((t) => t.name === "book_service_list_books");
  assert.ok(listBooks);
  assert.equal(listBooks.path, "/library.v1.BookService/ListBooks");
  assert.deepEqual(
    listBooks.params.map((p) => [p.argName, p.type]),
    [
      ["page_size", "int32"],
      ["page_token", "string"],
    ],
  );

  // Nested message input type resolves to the nested message's fields.
  const getContact = tools.find((t) => t.name === "book_service_get_contact");
  assert.ok(getContact);
  assert.deepEqual(
    getContact.params.map((p) => [p.argName, p.type]),
    [
      ["email", "string"],
      ["phone", "string"],
    ],
  );
});

test("grpcTools maps complex field types through untouched", () => {
  const proto = `
package demo;
message Req {
  map<string, int32> scores = 1;
  repeated Book books = 2;
  library.v1.Author author = 3;
}
message Book { string title = 1; }
service DemoService {
  rpc DoThing(Req) returns (Req);
}
`;
  const tools = grpcTools(parseProto(proto));
  assert.deepEqual(
    tools[0].params.map((p) => [p.argName, p.type]),
    [
      ["scores", "map<string, int32>"],
      ["books", "Book"],
      ["author", "library.v1.Author"],
    ],
  );
});

test("grpcTools hand-built packages without message info yield empty params", () => {
  const packages: ProtoPackage[] = [
    {
      name: "manual.v1",
      services: [
        {
          name: "ManualService",
          methods: [
            { name: "Ping", inputType: "PingRequest", outputType: "PingResponse", serverStreaming: false, clientStreaming: false },
          ],
        },
      ],
    },
  ];
  const tools = grpcTools(packages);
  assert.equal(tools[0].name, "manual_service_ping");
  assert.equal(tools[0].path, "/manual.v1.ManualService/Ping");
  assert.deepEqual(tools[0].params, []);
});

test("formatGrpcTools emits one line per method", () => {
  const packages = parseProto(REAL_ISH_PROTO);
  const lines = formatGrpcTools(grpcTools(packages)).split("\n");
  assert.deepEqual(lines, [
    "book_service_get_book (gRPC BookService.GetBook)",
    "book_service_list_books (gRPC BookService.ListBooks)",
    "book_service_upload_books (gRPC BookService.UploadBooks)",
    "book_service_get_contact (gRPC BookService.GetContact)",
  ]);
});
