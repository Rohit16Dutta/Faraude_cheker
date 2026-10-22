"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeBdPhone } = require("./lib/phone");
const { createCouriers, checkAll } = require("./lib/couriers");
const { aggregate } = require("./lib/aggregate");
const { createReportStore, REASONS } = require("./lib/reports");

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function createApp({
  env = process.env,
  fetch = globalThis.fetch,
  reportsFile = path.join(__dirname, "data", "reports.json"),
} = {}) {
  const demo = env.DEMO_MODE === "1" || env.DEMO_MODE === "true";
  const couriers = createCouriers({ env, fetch, demo });
  const reports = createReportStore(reportsFile);
  const cacheTtl = (Number(env.CACHE_MINUTES) || 30) * 60 * 1000;
  const rateLimit = Number(env.RATE_LIMIT_PER_MINUTE) || 30;
  const accessKey = String(env.ACCESS_KEY || "");
  const cache = new Map();
  const hits = new Map();

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
    res.writeHead(status, {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function authorized(req) {
    if (!accessKey) return true;
    const given = Buffer.from(String(req.headers["x-access-key"] || ""));
    const want = Buffer.from(accessKey);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }

  function limited(req) {
    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const entry = hits.get(ip);
    if (!entry || entry.reset < now) {
      hits.set(ip, { count: 1, reset: now + 60000 });
      return false;
    }
    entry.count++;
    return entry.count > rateLimit;
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 10000) throw new Error("Request too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }

  async function lookup(phone, refresh) {
    const cached = cache.get(phone);
    let courierResults;
    let checkedAt;
    if (!refresh && cached && cached.expires > Date.now()) {
      ({ courierResults, checkedAt } = cached);
    } else {
      courierResults = await checkAll(couriers, phone);
      checkedAt = new Date().toISOString();
      // Only cache when every configured courier answered, so a temporary error isn't remembered.
      if (courierResults.every((c) => c.status !== "error")) {
        cache.set(phone, { courierResults, checkedAt, expires: Date.now() + cacheTtl });
      }
    }
    const phoneReports = reports.forPhone(phone);
    return {
      phone,
      checkedAt,
      demo,
      overall: aggregate(courierResults, phoneReports),
      couriers: courierResults,
      reports: phoneReports,
    };
  }

  async function api(req, res, url) {
    if (!authorized(req)) return send(res, 401, { error: "Access key required" });

    if (req.method === "GET" && url.pathname === "/api/couriers") {
      return send(res, 200, {
        demo,
        couriers: couriers.map(({ id, name, configured, env: keys }) => ({ id, name, configured, env: keys })),
        reasons: REASONS,
      });
    }

    if (limited(req)) return send(res, 429, { error: "Too many requests — wait a minute and try again" });

    if (req.method === "GET" && url.pathname === "/api/check") {
      const phone = normalizeBdPhone(url.searchParams.get("phone"));
      if (!phone) return send(res, 400, { error: "Enter a valid Bangladeshi mobile number, like 01712345678" });
      return send(res, 200, await lookup(phone, url.searchParams.get("refresh") === "1"));
    }

    if (req.method === "POST" && url.pathname === "/api/reports") {
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        return send(res, 400, { error: "Invalid request" });
      }
      const phone = normalizeBdPhone(body.phone);
      if (!phone) return send(res, 400, { error: "Enter a valid Bangladeshi mobile number" });
      try {
        reports.add({ phone, reason: body.reason, note: body.note, shop: body.shop });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
      return send(res, 201, { ok: true, reports: reports.forPhone(phone) });
    }

    return send(res, 404, { error: "Not found" });
  }

  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch (e) {
      return send(res, 400, "Bad request");
    }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden");
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, "Not found");
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      api(req, res, url).catch((e) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, { error: "Something went wrong" });
      });
    } else {
      serveStatic(req, res, url);
    }
  });
}

if (require.main === module) {
  try {
    process.loadEnvFile(path.join(__dirname, ".env"));
  } catch (e) {
    // .env is optional — settings can also come from the real environment.
  }
  const port = Number(process.env.PORT) || 3000;
  const server = createApp();
  server.listen(port, () => {
    const configured = createCouriers({ env: process.env }).filter((c) => c.configured).map((c) => c.name);
    console.log(`Fraud Checker running at http://localhost:${port}`);
    if (process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true") console.log("DEMO_MODE is on — courier numbers are fake.");
    else console.log(`Couriers configured: ${configured.length ? configured.join(", ") : "none (add credentials to .env)"}`);
  });
}

module.exports = { createApp };
