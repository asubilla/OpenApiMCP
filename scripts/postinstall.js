import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("dist/cli.js")) {
  console.log("openapimcp installed (dev mode). Run `npm run build` then `npx openapimcp setup <spec>`.");
  process.exit(0);
}

spawnSync(process.execPath, ["dist/cli.js", "setup", "--postinstall", "--quiet"], { stdio: "inherit" });
