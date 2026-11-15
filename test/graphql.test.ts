import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGraphQLSchema,
  graphqlToToolName,
  buildGraphQLQuery,
} from "../src/graphql.js";

const SDL = `
"""Root query type"""
type Query {
  """Get a user by id"""
  getUser(id: ID!, name: String = "anon"): User
  # list users
  listUsers(limit: Int): [User]
}

type Mutation {
  createUser(name: String!, email: String): User
}

type Subscription {
  onUserCreated: User
}
`;

test("parseGraphQLSchema extracts operations", () => {
  const ops = parseGraphQLSchema(SDL);
  assert.equal(ops.length, 4);
  const get = ops.find((o) => o.name === "getUser");
  assert.ok(get);
  assert.equal(get.type, "query");
  assert.equal(get.description, "Get a user by id");
  assert.deepEqual(get.args, [
    { name: "id", type: "ID!" },
    { name: "name", type: "String" },
  ]);
  const list = ops.find((o) => o.name === "listUsers");
  assert.ok(list);
  assert.equal(list.type, "query");
  assert.equal(list.description, "list users");
  const create = ops.find((o) => o.name === "createUser");
  assert.ok(create);
  assert.equal(create.type, "mutation");
  const sub = ops.find((o) => o.name === "onUserCreated");
  assert.ok(sub);
  assert.equal(sub.type, "subscription");
  assert.deepEqual(sub.args, []);
});

test("graphqlToToolName sanitizes", () => {
  const op = parseGraphQLSchema(SDL)[0];
  assert.equal(graphqlToToolName(op), "getUser");
  const weird = { name: "get-user.v2", type: "query" as const, args: [] };
  assert.equal(graphqlToToolName(weird), "get_user_v2");
});

test("buildGraphQLQuery produces valid query string", () => {
  const op = parseGraphQLSchema(SDL).find((o) => o.name === "getUser")!;
  const q = buildGraphQLQuery(op, { id: "1", name: "Alice" });
  assert.match(q, /^query \{ getUser\(/);
  assert.match(q, /id: "1"/);
  assert.match(q, /name: "Alice"/);
});

test("buildGraphQLQuery mutation", () => {
  const op = parseGraphQLSchema(SDL).find((o) => o.name === "createUser")!;
  const q = buildGraphQLQuery(op, { name: "Bob" });
  assert.match(q, /^mutation \{ createUser\(/);
  assert.match(q, /name: "Bob"/);
});
