import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(process.argv[2], "utf8").trimEnd();
const dst = process.argv[3];
const lines = src.split(/\r?\n/);

const FONT = `'SF Mono', ui-monospace, monospace`;
const SIZE = 14;
const PAD_X = 16;
const LINE = 20;
const LABEL_BAR = 44;
const W = 920;
const H = LABEL_BAR + lines.length * LINE + 28;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const color = (l) => {
  if (l.startsWith("$ ")) return "#7ee787"; // commands: green
  if (/HTTP 2\d\d/.test(l)) return "#79c0ff"; // success: blue
  if (/HTTP \d/.test(l)) return "#ffa657"; // non-2xx: amber
  if (/GET http/.test(l)) return "#a5d6ff"; // URL lines: light blue
  if (l.startsWith("{") || l.startsWith("}") || l.startsWith("[") || /^\s*"/.test(l) || l.startsWith("]")) return "#e6edf3"; // JSON: default
  return "#c9d1d9"; // body text: grey
};

const text = (line) => {
  const els = [`<text x="${PAD_X}" y="0" font-family="${FONT}" font-size="${SIZE}" fill="${color(line)}" xml:space="preserve">${escape(line)}</text>`];
  return els.join("");
};

const rows = lines.map((l, i) => `<g transform="translate(0,${LABEL_BAR + i * LINE})">${text(l)}</g>`).join("\n    ");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0d1117" rx="10"/>
  <rect width="${W}" height="${LABEL_BAR}" fill="#161b22" rx="10"/>
  <rect width="${W}" height="12" y="${LABEL_BAR - 12}" fill="#161b22"/>
  <circle cx="${LABEL_BAR - 6}" cy="${LABEL_BAR / 2 + 2}" r="6" fill="#ff5f56"/>
  <circle cx="${LABEL_BAR + 14}" cy="${LABEL_BAR / 2 + 2}" r="6" fill="#ffbd2e"/>
  <circle cx="${LABEL_BAR + 34}" cy="${LABEL_BAR / 2 + 2}" r="6" fill="#27c93f"/>
  <text x="${W / 2}" y="${LABEL_BAR / 2 + 8}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#8b949e">openapimcp — live session</text>
  ${rows}
</svg>
`;

writeFileSync(dst, svg, "utf8");
console.log(`wrote ${dst} (${H}px)`);
