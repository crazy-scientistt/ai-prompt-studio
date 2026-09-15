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

# ── Server patches: inject snippets at specific route anchors ───────────────
# The upstream if-chain returns early, so a snippet must sit BEFORE the first
# route it needs to guard. Both injections are idempotent (guard grep).
inject_snippet() {
  SNIP="$1"; ANCHOR="$2"; GUARD="$3"; LABEL="$4"
  if [ -f "$SERVER_TS" ] && [ -f "$SNIP" ] && ! grep -q "$GUARD" "$SERVER_TS"; then
    awk -v snip="$SNIP" -v anchor="$ANCHOR" '
      !done && index($0, anchor) > 0 { while ((getline line < snip) > 0) print line; done=1 }
      { print }
    ' "$SERVER_TS" > /tmp/server.ts.new \
      && mv /tmp/server.ts.new "$SERVER_TS" \
      && echo "[entrypoint] $LABEL injected" \
      || echo "[entrypoint] WARN: $LABEL not injected"
  fi
}

# 1) Access control (dashboard basic auth + API key) — before ALL routes.
inject_snippet /app/auth-gate.snippet 'if (cleanPath === "/oauth/start") {' 'DASHBOARD_USER' 'access control gate'
# 2) Site-wide model + runtime self-update endpoints.
inject_snippet /app/update-routes.snippet 'if (url.pathname === "/oauth-callback") {' 'api/update/check' 'model + update routes'

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
  var mbox=document.createElement('div');
  mbox.style.cssText='display:none;padding:10px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.4);background:#12142B;color:#E7E9FF;border:1px solid rgba(255,255,255,.1)';
  mbox.innerHTML='<div style="font-weight:700;margin-bottom:6px">Web app generation model</div>'+
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
    '<select id="aps-sm" style="background:#0B0D1E;color:#E7E9FF;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 8px;max-width:240px"></select>'+
    '<button id="aps-sm-save" style="background:#7C6CFF;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer">Save</button>'+
    '<span id="aps-sm-msg" style="font-size:12px;color:#9BA0C9"></span></div>'+
    '<div style="font-size:11px;color:#6B6F92;margin-top:5px">Every visitor uses this model — they cannot change it.</div>';
  c.appendChild(mbox);
  document.body.appendChild(c);
  function proxyKey(){ try{ return localStorage.getItem('aps_proxy_key')||'' }catch(e){ return '' } }
  function withKey(p){ var k=proxyKey(); return p+(k?(p.indexOf('?')>=0?'&':'?')+'key='+encodeURIComponent(k):'') }
  function showKeyPrompt(){
    up.style.cssText='padding:8px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.4);background:#FBBF24;color:#1F2937;cursor:pointer;font-weight:700';
    up.textContent='🔑 Enter proxy key to enable updates';
    up.style.display='block';
    up.onclick=function(){
      var k=window.prompt('Paste this proxy\'s ADMIN_KEY:');
      if(k){ try{ localStorage.setItem('aps_proxy_key',k.trim()) }catch(e){} location.reload() }
    };
  }
  fetch(withKey('/api/update/check')).then(function(r){
    if(r.status===401){ showKeyPrompt(); return null }
    return r.json();
  }).then(function(d){
    if(!d)return;
    if(d.ok){
      var badge=[].slice.call(document.querySelectorAll('span,div')).find(function(e){return /^v[0-9]+\.[0-9]+\.[0-9]+$/.test((e.textContent||'').trim())});
      if(badge){badge.textContent='client '+d.current;badge.title='Proxy build stays v0.7.0 · the impersonated Antigravity client gates the model catalog'}
      mbox.style.display='block';
      var sel=document.getElementById('aps-sm'), msg=document.getElementById('aps-sm-msg');
      fetch(withKey('/v1/models')).then(function(r){return r.json()}).then(function(m){
        var ids=((m&&m.data)||[]).map(function(x){return x.id}).filter(function(id){return /^(gemini|claude|gpt)/.test(id)}).sort();
        ids.forEach(function(id){ var o=document.createElement('option'); o.value=id; o.textContent=id; sel.appendChild(o) });
        var o2=document.createElement('option'); o2.value=''; o2.textContent='(automatic — newest flash)'; sel.appendChild(o2);
        return fetch(withKey('/api/site-model')).then(function(r){return r.json()});
      }).then(function(sm){
        if(sm&&typeof sm.model==='string') sel.value=sm.model;
      }).catch(function(){});
      document.getElementById('aps-sm-save').onclick=function(){
        msg.textContent='Saving…';
        fetch(withKey('/api/site-model'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:sel.value})})
          .then(function(r){return r.json()})
          .then(function(r){ msg.textContent=r.ok?('✓ web app now uses '+(sel.value||'automatic')):('✗ '+(r.error||'failed')) })
          .catch(function(e){ msg.textContent='✗ '+e });
      };
    }
    if(!d.ok)return;
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
        fetch(withKey('/api/update/apply'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:d.latest})})
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

# ── ADD ACCOUNT → code-paste page on public hosts ────────────────────────────
# The header button points at /oauth/start, which sends the browser straight
# to Google and then to localhost — wrong machine on a public host (and the
# code can get eaten by a local proxy). Locally the direct flow works and
# stays one-click, so it is only rewritten for public deployments.
HEADER_HTML="$FRONTEND_DIR/components/header.html"
case "$EXTERNAL_URL" in
  http://localhost*|http://127.0.0.1*) IS_LOCAL=1 ;;
  *) IS_LOCAL=0 ;;
esac
if [ "$IS_LOCAL" = "0" ] && [ -f "$HEADER_HTML" ] && ! grep -q 'frontend/enroll.html' "$HEADER_HTML"; then
  sed -i 's|<a href="/oauth/start"|<a href="/frontend/enroll.html"|' "$HEADER_HTML" \
    && echo "[entrypoint] ADD ACCOUNT now opens the code-paste page (public host)"
fi

exec "$@"
