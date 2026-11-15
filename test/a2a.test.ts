import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentCard, createTask, updateTaskStatus, formatAgentCard } from "../src/a2a.js";

test("buildAgentCard shape", () => {
  const card = buildAgentCard({
    name: "Agent",
    description: "desc",
    url: "http://localhost",
    version: "1.0.0",
    skills: [{ id: "s1", name: "Skill", description: "d" }],
    capabilities: { streaming: true },
    authSchemes: ["bearer"],
  });
  assert.equal(card.name, "Agent");
  assert.equal(card.capabilities.streaming, true);
  assert.equal(card.authentication?.schemes[0], "bearer");
  assert.equal(card.skills.length, 1);
});

test("createTask default status", () => {
  const t = createTask("hello");
  assert.equal(t.status, "submitted");
  assert.equal(t.message, "hello");
  assert.ok(typeof t.id === "string" && t.id.length > 0);
});

test("updateTaskStatus transitions", () => {
  const t = createTask("hello");
  const t2 = updateTaskStatus(t, "working");
  assert.equal(t2.status, "working");
  assert.equal(t.status, "submitted");
  const t3 = updateTaskStatus(t2, "completed", "done");
  assert.equal(t3.status, "completed");
  assert.equal(t3.message, "done");
  assert.equal(t2.status, "working");
});

test("formatAgentCard contains name", () => {
  const card = buildAgentCard({
    name: "MyAgent",
    description: "desc",
    url: "http://localhost",
    version: "1.0.0",
    skills: [],
  });
  const s = formatAgentCard(card);
  assert.ok(s.includes("MyAgent"));
});
