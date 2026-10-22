# Fraud Checker

A simple website that helps people spot scams before they click, reply or pay.
It checks three things:

| Check | What it looks for |
| --- | --- |
| **Website link** | Fake brand domains (`paypal-secure.xyz`), lookalikes (`paypa1.com`, `amazom.com`), raw IP addresses, punycode, `@` tricks, link shorteners, risky domain endings, missing HTTPS, app/program downloads |
| **Message** (SMS / WhatsApp / email text) | Requests for OTPs, PINs or passwords; gift card / crypto / wire payments; urgency and threats; prizes and lotteries; "guaranteed returns"; fake jobs; KYC / account verification; parcel fees; remote-access apps — plus a check of every link inside it |
| **Email address** | Disposable inboxes, company-sounding names on free accounts (`paypal.security@gmail.com`), lookalike company domains, random-looking usernames |

Each check gives a risk score (0–100), a verdict (**High risk**, **Suspicious** or **No major red flags**) and a plain-language explanation of every warning sign it found.

**Privacy:** everything runs in the browser. There's no server, and nothing you paste is sent anywhere.

> ⚠️ This tool uses heuristics. It catches common scam patterns but can't prove something is safe.

## Run it

It's a static site with no build step. Open `index.html` directly, or serve the folder:

```bash
npm start          # serves the site with `npx serve`
```

To publish it for free, enable **GitHub Pages** for the repository (Settings → Pages → deploy from branch, root folder).

## Project layout

```
index.html        page markup
styles.css        styles (light + dark mode, mobile friendly)
js/checks.js      all detection rules — pure functions, no DOM
js/app.js         UI wiring
tests/            unit tests for the rules (Node's built-in test runner)
```

## Tests

```bash
npm test
```

## Extending the rules

- Add a commonly impersonated brand to `BRANDS` in `js/checks.js` with its official domains.
- Add message patterns to `MESSAGE_RULES` (severity `high` / `medium` / `low`).
- Add a test for each new rule in `tests/checks.test.js`.
