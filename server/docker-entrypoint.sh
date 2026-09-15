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

# ── Current client identity → unlocks the newest model catalog ──────────────
# Google serves the model list per client version; the image's 1.15.8 identity
# caps the catalog at gemini-3.6. Desired version resolution order:
#   1. /data/.client-version   (set by the runtime self-update endpoint)
#   2. ANTIGRAVITY_CLIENT_VERSION env var
#   3. 2.12.2 (current IDE at time of writing)
# Applied whenever headers.ts differs from the desired version (the container
# filesystem reverts on every recreation — /data persists), and stored account
# fingerprints (which cache the old user-agent) are regenerated with it.
HEADERS_TS="/app/src/utils/headers.ts"
if [ -f "$HEADERS_TS" ]; then
  CLIENT_VERSION="$(cat /data/.client-version 2>/dev/null || true)"
  CLIENT_VERSION="${CLIENT_VERSION:-${ANTIGRAVITY_CLIENT_VERSION:-2.12.2}}"
  if ! grep -q "ANTIGRAVITY_VERSION = \"$CLIENT_VERSION\"" "$HEADERS_TS"; then
    sed -i "s/const ANTIGRAVITY_VERSION = \"[0-9.]*\"/const ANTIGRAVITY_VERSION = \"$CLIENT_VERSION\"/" "$HEADERS_TS" \
      && echo "[entrypoint] impersonated client → antigravity/$CLIENT_VERSION"
    bun -e 'const fs=require("fs");const f="/data/antigravity-accounts.json";try{const j=JSON.parse(fs.readFileSync(f,"utf8"));let n=0;for(const a of j.accounts||[]){if(a.fingerprint){delete a.fingerprint;n++}}fs.writeFileSync(f,JSON.stringify(j,null,2));console.log("[entrypoint] regenerated fingerprints for "+n+" account(s)")}catch(e){console.log("[entrypoint] fingerprint regen skipped:",e.message)}' || true
  fi
fi

# ── Runtime self-update routes (check/apply new client version) ─────────────
# Injected into the proxy server so new Antigravity client versions (which
# unlock new model catalogs) can be adopted from the dashboard — no rebuild
# or platform redeploy. Sits right before the /oauth-callback route.
if [ -f "$SERVER_TS" ] && ! grep -q 'api/update/check' "$SERVER_TS"; then
  awk '/if \(url.pathname === "\/oauth-callback"\) \{/ && !done { while ((getline line < "/app/update-routes.snippet") > 0) print line; done=1 } { print }' "$SERVER_TS" > /tmp/server.ts.new \
    && mv /tmp/server.ts.new "$SERVER_TS" \
    && echo "[entrypoint] runtime update routes installed (/api/update/check|apply)" \
    || echo "[entrypoint] WARN: update routes not installed"
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

# ── Dashboard widget: enroll link + one-click update ─────────────────────────
# The upstream dashboard has neither a code-paste field nor update awareness,
# so this injects a tiny floating widget (written to its own file, referenced
# with one script tag) into the dashboard UI.
WIDGET_JS="$FRONTEND_DIR/aps-widget.js"
if [ -d "$FRONTEND_DIR" ]; then
  cat > "$WIDGET_JS" <<'WIDGET_JS_SRC'
(function(){
  var c=document.createElement('div');
  c.style.cssText='position:fixed;bottom:14px;right:14px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:flex-end;font-family:system-ui,sans-serif;font-size:13px';
  var enroll=document.createElement('div');
  enroll.style.cssText='background:#7C6CFF;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.4)';
  enroll.innerHTML='Adding another account? <a style="color:#fff;text-decoration:underline" href="/frontend/enroll.html">Paste the login code here</a>';
  c.appendChild(enroll);
  var up=document.createElement('div');
  up.style.cssText='padding:8px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.4);display:none';
  c.appendChild(up);
  document.body.appendChild(c);
  fetch('/api/update/check').then(function(r){return r.json()}).then(function(d){
    if(!d||!d.ok)return;
    if(d.upToDate===true){
      up.style.cssText+='background:rgba(52,211,153,.14);color:#34D399';
      up.textContent='Antigravity client v'+d.current+' — up to date';
      up.style.display='block';
    }else if(d.latest){
      up.style.cssText+='background:#7C6CFF;color:#fff;cursor:pointer;font-weight:700';
      up.textContent='⬆ New client v'+d.latest+' available — Update now';
      up.style.display='block';
      up.onclick=function(){
        up.textContent='Updating to v'+d.latest+'… restarting…';
        up.style.cursor='default';
        fetch('/api/update/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:d.latest})})
          .then(function(r){return r.json()})
          .then(function(r){
            up.textContent=r.ok?('Updated to v'+d.latest+' — reloading…'):(('✗ '+(r.error||'failed')));
            if(r.ok)setTimeout(function(){location.reload()},15000);
          })
          .catch(function(e){up.textContent='✗ '+e});
      };
    }
  }).catch(function(){});
})();
WIDGET_JS_SRC
  INDEX_HTML="$FRONTEND_DIR/index.html"
  if [ -f "$INDEX_HTML" ] && ! grep -q 'aps-widget.js' "$INDEX_HTML"; then
    sed -i 's|</body>|<script src="/frontend/aps-widget.js" defer></script></body>|' "$INDEX_HTML" \
      && echo "[entrypoint] dashboard widget installed (enroll link + update button)"
  fi
fi

exec "$@"
