"use strict";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

class CourierError extends Error {
  constructor(message, { authExpired = false } = {}) {
    super(message);
    this.authExpired = authExpired;
  }
}

// Minimal cookie jar for portals that use session cookies.
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  store(headers) {
    const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of list) {
      const pair = line.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0\b|expires=thu, 01 jan 1970/i.test(line) || value === "deleted") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

// fetch wrapper with timeout, JSON/form bodies, bearer tokens and an optional cookie jar.
// Redirects are not followed so callers can tell "logged in" from "sent back to the login page".
async function request(fetchImpl, url, opts = {}) {
  const { method = "GET", json, form, token, jar, headers = {}, timeoutMs = 15000 } = opts;
  const h = { "User-Agent": BROWSER_UA, Accept: "application/json, text/plain, */*", ...headers };
  let body;
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  if (token) h.Authorization = `Bearer ${token}`;
  if (jar && jar.cookies.size) h.Cookie = jar.header();

  let res;
  try {
    res = await fetchImpl(url, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const reason = e.name === "TimeoutError" ? "timed out" : "could not connect";
    throw new CourierError(`Request ${reason}`);
  }
  if (jar) jar.store(res.headers);
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch (e) {
    parsed = undefined;
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    redirected: res.status >= 300 && res.status < 400,
    location: res.headers.get("location") || "",
    text,
    data: parsed,
  };
}

// Caches a login result (token or cookie jar) and re-logs in once if the courier says it expired.
function createSession(login, ttlMs) {
  let current = null;
  return {
    async run(fn) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!current || current.expires < Date.now()) {
          current = { value: await login(), expires: Date.now() + ttlMs };
        }
        try {
          return await fn(current.value);
        } catch (e) {
          if (!e.authExpired || attempt === 1) throw e;
          current = null;
        }
      }
    },
  };
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

module.exports = { request, CookieJar, CourierError, createSession, toInt };
