/** Self-contained developer portal served by the HTTP gateway. */
export function portalHtml(mcpPath: string, serverName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(serverName)} — MCP Portal</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --border:#262a33; --text:#e6e8eb; --muted:#9aa0a6; --accent:#7c5cff; --ok:#34d399; --err:#f87171; --code:#0b0d12; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); }
  header { padding: 20px 24px; border-bottom: 1px solid var(--border); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:18px; margin:0; }
  header .sub { color:var(--muted); font-size:13px; }
  .endpoint { margin-left:auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:var(--muted); background:var(--code); padding:6px 10px; border-radius:6px; border:1px solid var(--border); }
  main { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(360px,1fr)); gap:16px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:10px; }
  .card h2 { font-size:15px; margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--accent); }
  .card .desc { color:var(--muted); font-size:13px; line-height:1.4; }
  .meta { display:flex; gap:8px; flex-wrap:wrap; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; background:var(--code); border:1px solid var(--border); color:var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .badge.method { color:var(--ok); }
  form { display:flex; flex-direction:column; gap:8px; margin-top:4px; }
  label { font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:4px; }
  input, textarea { background:var(--code); border:1px solid var(--border); color:var(--text); padding:8px 10px; border-radius:6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
  textarea { min-height:60px; resize:vertical; }
  .row { display:flex; gap:8px; }
  button { background:var(--accent); color:#fff; border:0; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px; }
  button:hover { filter: brightness(1.1); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .result { background:var(--code); border:1px solid var(--border); border-radius:6px; padding:10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; max-height:260px; overflow:auto; display:none; }
  .result.show { display:block; }
  .result.ok { border-color:var(--ok); }
  .result.err { border-color:var(--err); color:var(--err); }
  .status { font-size:12px; color:var(--muted); }
  .empty { color:var(--muted); text-align:center; padding:40px; }
  footer { text-align:center; color:var(--muted); font-size:12px; padding:24px; }
  a { color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>⚡ ${escapeHtml(serverName)}</h1>
  <span class="sub">MCP Developer Portal</span>
  <span class="endpoint">POST ${escapeHtml(mcpPath)}</span>
</header>
<main>
  <div id="status" class="status">Loading tools…</div>
  <div id="grid" class="grid"></div>
</main>
<footer>Powered by <a href="https://www.npmjs.com/package/openapimcp">openapimcp</a> · <a href="${escapeHtml(mcpPath)}">${escapeHtml(mcpPath)}</a></footer>
<script>
const MCP = ${JSON.stringify(mcpPath)};
const grid = document.getElementById('grid');
const status = document.getElementById('status');

async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random()*1e6), method, params: params || {} })
  });
  const text = await res.text();
  // support SSE or plain JSON
  let data = null;
  try { data = JSON.parse(text); } catch {
    const m = text.match(/data:\\s*(\\{.*\\})/s);
    if (m) try { data = JSON.parse(m[1]); } catch {}
  }
  return { status: res.status, data };
}

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

function buildForm(tool) {
  const form = el('form');
  const inputs = {};
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const required = (tool.inputSchema && tool.inputSchema.required) || [];
  for (const [key, sch] of Object.entries(props)) {
    const lab = el('label');
    lab.textContent = key + (required.includes(key) ? ' *' : '');
    const inp = document.createElement('input');
    inp.name = key;
    inp.placeholder = (sch && sch.description) || (sch && sch.type) || '';
    if (sch && sch.type === 'boolean') inp.type = 'checkbox';
    if (sch && sch.type === 'number') inp.type = 'number';
    if (sch && sch.type === 'integer') inp.type = 'number';
    lab.appendChild(inp);
    form.appendChild(lab);
    inputs[key] = inp;
  }
  if (Object.keys(props).length === 0) {
    const note = el('div', 'status', 'No parameters.');
    form.appendChild(note);
  }
  const btn = el('button', '', 'Run');
  btn.type = 'submit';
  form.appendChild(btn);
  const result = el('div', 'result');
  form.appendChild(result);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    result.className = 'result show';
    result.textContent = 'Running…';
    const args = {};
    for (const [key, inp] of Object.entries(inputs)) {
      const sch = props[key] || {};
      let v = (sch.type === 'boolean') ? inp.checked : inp.value;
      if (v === '') { if (!required.includes(key)) continue; }
      if (sch.type === 'number' || sch.type === 'integer') { if (v !== '') v = Number(v); else continue; }
      if (sch.type === 'array') { try { v = JSON.parse(v); } catch {} }
      if (sch.type === 'object') { try { v = JSON.parse(v); } catch {} }
      if (v !== '' || required.includes(key)) args[key] = v;
    }
    try {
      const r = await rpc('tools/call', { name: tool.name, arguments: args });
      const text = (r.data && r.data.result && r.data.result.content && r.data.result.content[0] && r.data.result.content[0].text) || JSON.stringify(r.data, null, 2);
      result.textContent = text;
      result.className = 'result show ' + (r.data && r.data.result && r.data.result.isError ? 'err' : 'ok');
    } catch (err) {
      result.textContent = 'Error: ' + err;
      result.className = 'result show err';
    } finally {
      btn.disabled = false;
    }
  });

  return form;
}

async function load() {
  try {
    const r = await rpc('tools/list', {});
    const tools = (r.data && r.data.result && r.data.result.tools) || [];
    status.textContent = tools.length + ' tool' + (tools.length === 1 ? '' : 's') + ' available';
    if (tools.length === 0) { grid.innerHTML = '<div class="empty">No tools exposed.</div>'; return; }
    for (const t of tools) {
      const card = el('div', 'card');
      card.appendChild(el('h2', '', escape(t.name)));
      if (t.description) card.appendChild(el('div', 'desc', escape(t.description)));
      const meta = el('div', 'meta');
      const m = (t.inputSchema && t.inputSchema.properties) ? Object.keys(t.inputSchema.properties).length : 0;
      meta.appendChild(el('span', 'badge method', t.name.split('_')[0] || 'tool'));
      meta.appendChild(el('span', 'badge', m + ' param' + (m === 1 ? '' : 's')));
      if (t.annotations && t.annotations.readOnlyHint) meta.appendChild(el('span', 'badge', 'read-only'));
      card.appendChild(meta);
      card.appendChild(buildForm(t));
      grid.appendChild(card);
    }
  } catch (err) {
    status.textContent = 'Failed to load tools: ' + err;
    grid.innerHTML = '<div class="empty">Could not reach the MCP endpoint.</div>';
  }
}

function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

load();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
