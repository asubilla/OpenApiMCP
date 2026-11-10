// End-to-end smoke test: spawn the CLI as an MCP server over stdio and run a
// real handshake (initialize -> tools/list -> tools/call).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "demo-api.json");

const useDist = process.env.USE_DIST === "1";
const args = useDist
  ? [path.join(root, "dist", "cli.js"), fixture]
  : ["--import", "tsx", path.join(root, "src", "cli.ts"), fixture];

const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

function request(method, params) {
  const id = Math.floor(Math.random() * 1e6);
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 15000);
  });
}

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.error(`FAIL ${label}`);
  }
}

const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "openapimcp-smoke", version: "1.0.0" }
});
check(Boolean(init.result), "initialize returns a result");

child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const list = await request("tools/list", {});
const names = (list.result?.tools ?? []).map((tool) => tool.name);
check(names.length >= 4, `tools/list exposes >= 4 tools (got ${names.length})`);
check(names.includes("getPetById"), "getPetById tool is present");
check(names.includes("addPet"), "addPet tool is present");

const call = await request("tools/call", { name: "getPetById", arguments: { petId: 1 } });
check(Boolean(call.result), "tools/call returns a result");
const output = call.result?.content?.[0]?.text ?? "";
console.log("--- tools/call output (first 200 chars) ---");
console.log(String(output).slice(0, 200));

child.kill();
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 200);
