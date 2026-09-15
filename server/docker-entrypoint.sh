#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Cloud-safe OAuth entrypoint.
#
# The Google client baked into this image only accepts LOOPBACK redirect_uris
# (http://localhost:3000/oauth-callback). Rewriting it to a public Railway URL
# makes Google block sign-in with "Error 400: invalid_request". So the
# redirect_uri stays loopback everywhere, and on a public host enrollment uses
# the code-paste flow served at /frontend/enroll.html (the entrypoint writes
# it on first boot — see ENROLL_HTML below).
#
# Also patched: the post-login redirect, so after the callback the browser
# lands back on THIS deployment's dashboard instead of localhost.
# ─────────────────────────────────────────────────────────────────────────────
set -e

EXTERNAL_URL="${EXTERNAL_URL:-http://localhost:3000}"
EXTERNAL_URL="${EXTERNAL_URL%/}"
SERVER_TS="/app/src/server.ts"
FRONTEND_DIR="/app/src/frontend"

if [ -f "$SERVER_TS" ]; then
  sed -i "s|http://localhost:3000/frontend/index.html|\${process.env.EXTERNAL_URL}/frontend/index.html|" "$SERVER_TS" \
    && echo "[entrypoint] post-login redirect now returns to \$EXTERNAL_URL (runtime)"
else
  echo "[entrypoint] WARN: $SERVER_TS not found — post-login redirect left unpatched"
fi

# ── Self-enroll page (code-paste flow for headless/public hosts) ────────────
if [ -d "$FRONTEND_DIR" ] && [ ! -f "$FRONTEND_DIR/enroll.html" ]; then
  mkdir -p "$FRONTEND_DIR"
  cat > "$FRONTEND_DIR/enroll.html" <<'ENROLL_HTML'
<!doctype html>
<html><head><meta charset="utf-8"><title>Enroll account — Antigravity Proxy</title>
<style>body{background:#0B0D1E;color:#E7E9FF;font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh}
.c{background:#12142B;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:32px;max-width:640px;width:calc(100vw - 32px)}
h1{font-size:20px;margin:0 0 4px}p{color:#9BA0C9;font-size:13.5px;line-height:1.6}
a.b{display:inline-block;background:#7C6CFF;color:#fff;text-decoration:none;border-radius:12px;padding:11px 18px;font-weight:700;font-size:14px}
input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:12px;padding:13px 14px;font-size:14px;margin:14px 0 10px}
button{width:100%;background:#7C6CFF;color:#fff;border:0;border-radius:12px;padding:13px 18px;font-weight:700;font-size:14px;cursor:pointer}
.ok{color:#34D399}.err{color:#F87171;white-space:pre-wrap}small{color:#6B6F92}code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px}</style></head>
<body><div class="c">
<h1>Enroll your Google account</h1>
<p>The OAuth client only allows <code>localhost</code> redirects, so this host uses a code paste:</p>
<p><b>1.</b> <a class="b" id="go" href="#" target="_blank" rel="noreferrer">Open Google sign-in ↗</a></p>
<p><b>2.</b> After approving, the browser lands on <code>localhost:3000/…?code=…</code> — copy the <b>code</b> value from the address bar. <b>Stop the page immediately</b> — if a local proxy is running on port 3000 it will consume the code (codes are single-use). If that happens, just sign in again and copy faster, or stop the local container first.</p>
<p><b>3.</b> Paste it here:</p>
<input id="code" placeholder="4/0AQSTgQ…  (paste the code=… value)">
<button onclick="sub()">Enroll account</button>
<p id="out"></p>
<small>Nothing is stored in the browser. Tokens live only in this server's /data volume.</small>
</div>
<script>
document.getElementById('go').href = '/oauth/start';
const params = new URLSearchParams(location.search);
if (params.get('code')) { document.getElementById('code').value = params.get('code'); sub(); }
async function sub(){
  const code = document.getElementById('code').value.trim();
  const out = document.getElementById('out');
  if(!code){ out.className='err'; out.textContent='Paste the code first.'; return; }
  out.textContent='Enrolling…';
  try{
    const r = await fetch('/oauth-callback?code='+encodeURIComponent(code));
    const t = await r.text();
    out.className = r.ok ? 'ok' : 'err';
    out.textContent = (r.ok?'✓ Enrolled — you can close this tab and open the dashboard. ':'✗ ')+t.slice(0,300);
  }catch(e){ out.className='err'; out.textContent='Network error: '+e; }
}
</script></body></html>
ENROLL_HTML
  echo "[entrypoint] wrote $FRONTEND_DIR/enroll.html"
fi

exec "$@"
