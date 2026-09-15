# AI Prompt Studio

**Upload the video you want → choose your AI video model → Generate → Copy → Paste → Create.**

AI Prompt Studio reverse-engineers reference videos into production-ready prompt kits
for AI video models (Veo, Kling, Seedance, Hailuo, Wan and more). Frame analysis,
camera/motion/lighting reasoning, clip splitting and model-specific compilation are
handled invisibly — the user never writes a prompt.

- Frontend: React + Vite + Tailwind (this repo, deploys to **Vercel**)
- Prompt-generation engine: an **isolated Antigravity proxy** (OpenAI-compatible,
  separate Docker project — no connection to any other proxy), deploys to **Railway**

---

## Deploying

### 1 · The proxy → Railway

Railway runs the proxy as a container service with a persistent volume for the
connected Google account.

1. Push this repo to GitHub (see below).
2. In Railway: **New Project → Deploy from GitHub repo** → when prompted for the
   root directory, enter **`server/`** and pick **`Dockerfile.proxy`** as the
   Dockerfile path.
3. After the first deploy, set these **Variables** on the service:

   | Variable | Value | Why |
   |---|---|---|
   | `EXTERNAL_URL` | `https://<your-service>.up.railway.app` (no trailing slash) | Post-login redirect target |
   | `BASE_URL` | same as `EXTERNAL_URL` | Used by the upstream image |
   | `SAFETY_THRESHOLD` | `BLOCK_NONE` | Stops upstream over-censoring |
   | `ADMIN_KEY` | long random string (e.g. `openssl rand -hex 24`) | **Locks the API**: `/v1/*` + `/api/*` require it. Without it anyone who finds the URL can spend your Google quota |
   | `DASHBOARD_USER` | your username | **Locks the dashboard** (browser password prompt) |
   | `DASHBOARD_PASS` | your password | Required with `DASHBOARD_USER` |

   Redeploy once after adding them. `/health` stays open for platform monitors.
4. **Settings → Volumes → attach a volume** mounted at **`/data`** — this is where
   enrolled accounts (`antigravity-accounts.json`) live. Without it, the account
   is lost on every redeploy.
5. Connect your Google account — **important:** the OAuth client inside the
   proxy only accepts `localhost` redirects (Google enforces this), so on a
   public host enrollment uses a quick code paste:

   1. Open `https://<your-service>.up.railway.app/frontend/enroll.html`
   2. Click **Open Google sign-in** → choose your account → approve
   3. The browser lands on `localhost:3000/…?code=…` (connection refused is
      fine — you only need the address bar). Copy the `code=` value.
      *If a local proxy is running on port 3000, stop it first or it will
      consume the single-use code.*
   4. Paste the code into the enroll page → **Enroll account** → ✓

   Locally (docker compose on your own machine), the normal "Add Account"
   button just works — no paste needed.
6. Models appear automatically at `/v1/models` once the account is connected.

> Railway gives every service an HTTPS URL, so the browser will not block the
> calls. If you put your own domain in front, use `https://` there too.

### 2 · The web app → Vercel

1. In Vercel: **Add New → Project** → import the same GitHub repo.
2. Framework preset **Vite** is auto-detected (`vercel.json` is included). Build
   command `npm run build`, output `dist` — no changes needed.
3. Add the proxy address as a **server-side** env var (recommended):

   | Variable | Value |
   |---|---|
   | `PROXY_URL` | `https://<your-service>.up.railway.app` — append `?key=<ADMIN_KEY>` when the proxy is locked |

   It is served at runtime by `api/config.js` (`GET /api/config`) and read by
   the app on load, so the proxy address and key never ship inside the JS
   bundle, and changing them needs no code edit.
4. Deploy. (Optional fallback: `VITE_PROXY_URL` is baked in at build time —
   fine for a local or private deployment, but it is readable in DevTools.)

**Without a rebuild**, you can point any deployment at any proxy by opening:
`https://<app>.vercel.app/?proxy=https://<your-service>.up.railway.app`
The value is saved in the browser, and admins can change it any time at
`#/admin` (there's an HTTPS/HTTP mismatch warning there too).

### 3 · Connect and verify

1. Open the app → `#/admin` → confirm the proxy URL and hit the ping test.
2. If no account is enrolled yet, use the enroll page on the proxy
   (`/frontend/enroll.html`) per the Railway steps above — locally the normal
   **Add Account** button works.
3. Generate a prompt kit from any reference video end-to-end.

> Moving the proxy does **not** increase the connected Google account's model
> quota — it's the same account, just hosted.

---

## Local development

```bash
npm install
npm run dev            # http://localhost:5173

# isolated proxy (separate Docker project — nothing shared with other proxies)
cd server
docker compose up      # proxy + OAuth on http://localhost:3000
```

Copy `.env.example` to `.env` to override the proxy URL at build time
(`VITE_PROXY_URL`), or just use `#/admin` / `?proxy=` at runtime.

UI regression tests (Playwright):

```bash
npx playwright test tests/ui.spec.mjs
```

The 36MB demo clip (`public/test-videos/`) is gitignored and dev-only; the
deployed app shows a friendly toast if it's missing.

---

## Repository layout

```
src/            React app (Studio, engine, components)
server/
  Dockerfile.proxy   the Antigravity proxy image (+ OAuth redirect patch)
  docker-entrypoint.sh
  docker-compose.yml local isolated deployment
  gateway.js         optional self-contained gateway (not needed on Railway)
public/         static assets
tests/          Playwright UI regression suite
```

## Choosing the web app's generation model (from the proxy)

The model every customer uses is decided **on the proxy**, not in the app:

- Open the Railway dashboard → floating widget (bottom-right) →
  **Web app generation model** → pick a model → **Save**
- The web app reads it on load and uses it for every visitor. Customers cannot
  change it (there is no model picker in the customer UI).
- Leave it on **(automatic — newest flash)** and the app picks the newest
  available flash itself.
- Under the hood: `GET/POST /api/site-model` (key protected) stores the choice
  in `/data/site-model.json`.

## Security (public deployments)

| Surface | Protection |
|---|---|
| Dashboard, `frontend/*`, enroll page | `DASHBOARD_USER` + `DASHBOARD_PASS` → browser Basic-auth prompt |
| `/v1/*` (models, chat) and `/api/*` (status, config, site-model, update) | `ADMIN_KEY` → `Authorization: Bearer <key>` or `?key=` |
| `/health` | open (monitoring) |
| Google account tokens | only in the proxy container's `/data` volume — never in the repo |
| Admin console in the web app | hidden; `#/admin` is PIN-gated by `VITE_ADMIN_PIN` |

The proxy address (and its `?key=`) is read at runtime from `PROXY_URL` via
`/api/config`, so it does **not** sit in the public bundle. That raises the bar —
a browser still has to make the call before it can see the value, and an endpoint
by definition has to be reachable by whoever uses it — so treat this as a strong
deterrent, not a wall.

What actually protects your Google quota in order of strength:

1. `ADMIN_KEY` — nobody can call `/v1/*` without it.
2. `DASHBOARD_USER` / `DASHBOARD_PASS` — your management surface is private.
3. Rate/credit limits per customer — the real answer for a paid product.

Before charging money, put a small backend between customers and the proxy:
real logins, a credits ledger, payment webhooks and the proxy key held
server-side. Everything a browser can read can eventually be extracted.

## Payments (before you charge customers)

Stripe is not available to Pakistani merchants and PayPal cannot receive, so the
working combination is **one local gateway + one merchant-of-record**:

| Need | Recommended | Why |
|---|---|---|
| Local cards + JazzCash + EasyPaisa in a **single** integration | **Safepay** or **Paymob Pakistan** (PayFast by APPS as the wide-coverage alternative, incl. Raast) | One API/SDK for all three methods, PCI-DSS, tokenization + recurring/subscription APIs, ~2-3.5% MDR, T+1 to T+3 settlement, onboarding in days |
| International customers paying by card | **Lemon Squeezy** or **Paddle** (merchant of record) | Pakistan is supported for payouts; they handle global VAT/sales tax and dispute liability as the seller of record, ~5% + $0.50 |
| Wallets only, no cards | JazzCash / easypaisa direct merchant accounts | Cheapest per wallet transaction, but limited card processing — pair them with a PSP rather than using them alone |

Fees, approval and settlement terms move fast in this market — confirm current
numbers with each provider during onboarding. Whichever you pick, the credit is
granted by a **server-side webhook handler**, never by the browser: the client
only starts the checkout and then polls for the granted balance.
