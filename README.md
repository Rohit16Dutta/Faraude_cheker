# Courier Check

A courier fraud checker for Bangladeshi online sellers, like the ones built into courier merchant panels. The difference is that it checks **every courier at once** and combines the results into one overall view.

Enter a customer's mobile number and it will:

1. **Detect which couriers you've connected.** Any courier with login details in `.env` is checked; the rest are skipped.
2. **Look up that number with each courier in parallel:** Steadfast, Pathao, RedX, Paperfly and Carrybee.
3. **Combine everything into one overall view:**
   - total parcels, delivered, and cancelled/returned
   - overall success rate and a verdict: ✅ **Trusted**, ⚠️ **Caution**, 🚨 **High risk**, 🆕 **New customer**
   - what to do next (e.g. take an advance payment)
   - a per-courier breakdown
   - reports from other merchants who use your checker

If one courier is down or rejects the login, the others still show. The page tells you which one failed and why.

## Quick start

Requires Node.js 20.12 or newer. There are no dependencies to install.

```bash
npm run demo        # try it with made-up courier numbers, no accounts needed
```

Open http://localhost:3000.

To use real data:

```bash
cp .env.example .env    # then fill in your courier merchant logins
npm start
```

The server prints which couriers it found credentials for.

## Deploy on Cloudflare (auto-updates from GitHub)

The site runs on **Cloudflare Workers**: `worker.mjs` handles the API and Cloudflare serves `public/` directly. Once the repo is connected, every push to GitHub redeploys the site automatically.

**One-time setup (works from a phone):**

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create → Import a repository**. Connect GitHub if asked, then pick `Rohit16Dutta/Faraude_cheker`.
3. Keep the project name **`courier-check`** (it must match `name` in `wrangler.toml`). Leave the build command empty and the deploy command as `npx wrangler deploy`. Then deploy.
4. When the first deploy finishes, open the Worker's **Settings → Variables and Secrets** and add each as a **Secret**:
   - `ACCESS_KEY`: any long password. The site asks for it once per device.
   - The logins for the couriers you use (`STEADFAST_USER`, `STEADFAST_PASSWORD`, `PATHAO_USER`, and so on; see the table below).
5. Open your site at `https://courier-check.<your-subdomain>.workers.dev`. A custom domain can be added under **Settings → Domains & Routes**.

The first deploy also creates the **REPORTS** KV namespace that stores seller reports. Secrets and dashboard variables are kept across deploys (`keep_vars = true`).

To try the site without courier accounts, add a variable `DEMO_MODE` = `1`.

From a computer you can also run `npx wrangler dev` to test locally on the Workers runtime, or `npx wrangler deploy` to deploy by hand.

## Configuration (`.env`)

| Setting | What it does |
| --- | --- |
| `STEADFAST_USER` / `STEADFAST_PASSWORD` | Steadfast merchant panel login |
| `PATHAO_USER` / `PATHAO_PASSWORD` | Pathao merchant login |
| `REDX_PHONE` / `REDX_PASSWORD` | RedX merchant login (phone as `01XXXXXXXXX`) |
| `PAPERFLY_USER` / `PAPERFLY_PASSWORD` | Paperfly merchant login |
| `CARRYBEE_PHONE` / `CARRYBEE_PASSWORD` | Carrybee merchant login |
| `ACCESS_KEY` | **Set this if the site is on the internet.** The API then requires this key, so strangers can't run lookups with your courier accounts. |
| `DEMO_MODE` | `1` shows fake numbers (clearly labelled) for trying the site |
| `CACHE_MINUTES` | How long a number's result is remembered (default 30) |
| `RATE_LIMIT_PER_MINUTE` | Checks per visitor per minute (default 30) |
| `PORT` | Default 3000 |

## How the score works

- The **success rate** is delivered ÷ (delivered + cancelled), across every courier that answered.
- **80% or more** is Trusted. **50–79%** is Caution. **Below 50%** is High risk. **No history** is New customer.
- **Merchant reports** raise the level: one report gives at least *Caution*, two or more give *High risk*.
- If there are fewer than 3 past parcels, or a courier couldn't be checked, the page adds a note.

## ⚠️ Important

- **These are not official courier APIs.** The couriers don't publish a public fraud-check API, so this logs in to their **merchant panels** with your account, the same way the existing BD fraud-checker plugins do. The couriers can change these at any time, and a courier may then stop working until its adapter is updated.
- **RedX** has started requiring OTP login on some accounts, which can't be automated. If RedX fails to log in, that is probably the reason.
- Check each courier's terms of service before using this in production.
- Customer phone numbers are personal data. Use the results only to decide how to ship an order.

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/check?phone=01712345678` | Overall view plus per-courier results and reports. Accepts `+880…`, spaces and Bangla digits. `&refresh=1` skips the cache. |
| `POST /api/reports` | Body: `{ "phone", "reason", "note"?, "shop"? }`. `reason` must be one of the values from `/api/couriers`. |
| `GET /api/couriers` | Which couriers are connected, plus the report reasons. |

If `ACCESS_KEY` is set, send it in the `X-Access-Key` header.

## Project layout

```
worker.mjs              Cloudflare Workers entry point (reports in Workers KV)
wrangler.toml           Cloudflare config
server.js               Node server for running locally (no dependencies)
lib/api.js              the JSON API, shared by the Worker and the Node server
lib/couriers/*.js       one adapter per courier; index.js finds the configured ones
lib/aggregate.js        combines courier results + reports into the overall view
lib/reports.js          merchant report rules; lib/report-store-file.js saves them locally
lib/phone.js            Bangladeshi mobile number normalisation
lib/http.js             fetch helper: timeouts, cookies, cached logins
public/                 the website (HTML, CSS, JS)
tests/                  unit + server tests (npm test)
```

### Adding another courier

1. Create `lib/couriers/<name>.js` exporting `{ id, name, env, createClient({ env, fetch }) }`. `createClient` returns `{ check(phone) }`, which resolves to `{ total, success, cancel }`.
2. Add it to the list in `lib/couriers/index.js`.
3. Add its variables to `.env.example` and a test with a fake `fetch` in `tests/courier.test.js`.

## Tests

```bash
npm test
```

The courier tests use a fake network, so they need no real accounts.

## Credits

The courier merchant-panel endpoints were identified with reference to the open-source [Fraud-Checker-BD-Courier-Laravel](https://github.com/AbiruzzamanMolla/Fraud-Checker-BD-Courier-Laravel) project. This is an independent implementation.
