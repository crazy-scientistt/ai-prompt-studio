// Runtime proxy configuration for the hosted (Vercel) build.
//
// Why this exists: a Vite build bakes VITE_* variables into the public JS
// bundle, so VITE_PROXY_URL would expose the proxy address (and its access key
// if appended) to anyone who opens DevTools. Reading it here instead keeps the
// value on the server and lets the owner rotate it — or move the proxy — with
// just an env change and a redeploy, never a code change.
//
// Set on Vercel → Settings → Environment Variables:
//   PROXY_URL = https://<your-proxy>.up.railway.app          (public dashboard)
//   PROXY_URL = https://<your-proxy>.up.railway.app?key=<ADMIN_KEY>   (locked)
//
// The app calls GET /api/config on boot; if it answers with a URL it wins over
// the baked VITE_PROXY_URL default. Locally (vite dev) there is no such route,
// so the app silently falls back to http://localhost:3000.
//
// Note: anything a browser can read is discoverable by a determined user — this
// removes the URL from the static bundle, it is not a substitute for the
// ADMIN_KEY gate on the proxy itself.
export default function handler(_req, res) {
  const proxyUrl = String(process.env.PROXY_URL || '').trim().replace(/\/+$/, '')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(200).json({ ok: true, proxyUrl })
}
