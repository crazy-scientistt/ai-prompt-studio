// Runtime proxy configuration for the hosted (Vercel) build.
//
// Why this exists: a Vite build bakes VITE_* variables into the public JS
// bundle, so VITE_PROXY_URL would expose the proxy address (and its access key
// if appended) to anyone who opens DevTools. Reading it here instead keeps the
// value on the server and lets the owner rotate it — or move the proxy — with
// just an env change and a redeploy, never a code change.
//
// Set on Vercel → Settings → Environment Variables:
//   BILLING_URL = https://<your-billing>.up.railway.app   accounts + payments
//   PROXY_URL   = https://<your-proxy>.up.railway.app?key=<ADMIN_KEY>
//
// With BILLING_URL set the app signs users in, reads plans and credits from the
// backend and sends AI calls through it (the proxy key never reaches a browser).
// With only PROXY_URL it runs in the legacy direct mode. Locally (vite dev)
// there is no such route, so the app falls back to its defaults.
//
// Note: anything a browser can read is discoverable by a determined user — this
// removes the URL from the static bundle, it is not a substitute for the
// ADMIN_KEY gate on the proxy itself.
export default function handler(_req, res) {
  const proxyUrl = String(process.env.PROXY_URL || '').trim().replace(/\/+$/, '')
  const billingUrl = String(process.env.BILLING_URL || '').trim().replace(/\/+$/, '')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(200).json({ ok: true, proxyUrl, billingUrl })
}
