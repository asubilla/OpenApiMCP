// Live demo: acts like an AI agent (MCP client), connects to a mcpify-generated
// server, lists its tools, and calls one against a real public API.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spec = process.argv[2] ?? "https://petstore3.swagger.io/api/v3/openapi.json";

const child = spawn(process.execPath, [path.join(root, "dist", "cli.js"), spec], {
  stdio: ["pipe", "pipe", "inherit"]
});

let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});

const call = (method, params) =>
  new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e6);
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "demo-agent", version: "1.0.0" }
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const { result: listed } = await call("tools/list", {});
console.log(`\n🧰 Agent ko ${listed.tools.length} tools mile:\n`);
for (const t of listed.tools.slice(0, 5)) console.log(`   • ${t.name.padEnd(22)} ${t.description}`);
console.log("   • ...and more\n");

console.log('🤖 Agent bolta hai: "Find pets available for adoption"\n');
const { result } = await call("tools/call", {
  name: "findPetsByStatus",
  arguments: { status: "available" }
});
console.log("🌐 Live API response:\n");
console.log(result.content[0].text.slice(0, 900));

child.kill();
process.exit(0);
