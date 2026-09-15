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

   | Variable | Value |
   |---|---|
   | `EXTERNAL_URL` | `https://<your-service>.up.railway.app` (no trailing slash) |
   | `BASE_URL` | same as `EXTERNAL_URL` |
   | `SAFETY_THRESHOLD` | `BLOCK_NONE` |

   Redeploy once after adding them.
4. **Settings → Volumes → attach a volume** mounted at **`/data`** — this is where
   enrolled accounts (`antigravity-accounts.json`) live. Without it, the account
   is lost on every redeploy.
5. Open `https://<your-service>.up.railway.app` → **Add Account** → sign in with
   Google. The OAuth callback now lands correctly because `EXTERNAL_URL` rewrites
   the `redirect_uri` at container start.
6. Models appear automatically at `/v1/models` once the account is connected.

> Railway gives every service an HTTPS URL, so the browser will not block the
> calls. If you put your own domain in front, use `https://` there too.

### 2 · The web app → Vercel

1. In Vercel: **Add New → Project** → import the same GitHub repo.
2. Framework preset **Vite** is auto-detected (`vercel.json` is included). Build
   command `npm run build`, output `dist` — no changes needed.
3. Optional env var: `VITE_PROXY_URL=https://<your-service>.up.railway.app`
   (build-time default for all visitors).
4. Deploy.

**Without a rebuild**, you can point any deployment at any proxy by opening:
`https://<app>.vercel.app/?proxy=https://<your-service>.up.railway.app`
The value is saved in the browser, and admins can change it any time at
`#/admin` (there's an HTTPS/HTTP mismatch warning there too).

### 3 · Connect and verify

1. Open the app → `#/admin` → confirm the proxy URL and hit the ping test.
2. If no account is enrolled yet: **Connect your Antigravity account → Open proxy
   dashboard → Add Account → Google sign-in**.
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

## Security notes

- Google OAuth tokens live **only** inside the proxy container's `/data` volume —
  never in the repo, never in the browser.
- No secrets are committed. `VITE_*` vars are public by design (baked into JS);
  keep the proxy URL un-gated or add your own auth layer before charging users.
- Credits/history currently persist in the browser (localStorage). Move them
  server-side before taking payments.
