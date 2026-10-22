"use strict";

// The JSON API, written against the standard Request/Response so it runs on Node and Cloudflare Workers.
const { normalizeBdPhone } = require("./phone");
const { createCouriers, checkAll } = require("./couriers");
const { aggregate } = require("./aggregate");
const { REASONS, buildReport } = require("./reports");

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function createApi({ env, fetch = globalThis.fetch, reports }) {
  const demo = env.DEMO_MODE === "1" || env.DEMO_MODE === "true";
  const couriers = createCouriers({ env, fetch, demo });
  const cacheTtl = (Number(env.CACHE_MINUTES) || 30) * 60 * 1000;
  const rateLimit = Number(env.RATE_LIMIT_PER_MINUTE) || 30;
  const accessKey = String(env.ACCESS_KEY || "");
  const cache = new Map();
  const hits = new Map();

  function limited(ip) {
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

  async function readJson(request) {
    if (Number(request.headers.get("content-length")) > 10000) throw new Error("Request too large");
    const text = await request.text();
    if (text.length > 10000) throw new Error("Request too large");
    return JSON.parse(text || "{}");
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
    const phoneReports = await reports.forPhone(phone);
    return {
      phone,
      checkedAt,
      demo,
      overall: aggregate(courierResults, phoneReports),
      couriers: courierResults,
      reports: phoneReports,
    };
  }

  async function route(request, ip) {
    const url = new URL(request.url);
    if (accessKey && !safeEqual(request.headers.get("x-access-key") || "", accessKey)) {
      return json(401, { error: "Access key required" });
    }

    if (request.method === "GET" && url.pathname === "/api/couriers") {
      return json(200, {
        demo,
        couriers: couriers.map(({ id, name, configured, env: keys }) => ({ id, name, configured, env: keys })),
        reasons: REASONS,
      });
    }

    if (limited(ip)) return json(429, { error: "Too many requests — wait a minute and try again" });

    if (request.method === "GET" && url.pathname === "/api/check") {
      const phone = normalizeBdPhone(url.searchParams.get("phone"));
      if (!phone) return json(400, { error: "Enter a valid Bangladeshi mobile number, like 01712345678" });
      return json(200, await lookup(phone, url.searchParams.get("refresh") === "1"));
    }

    if (request.method === "POST" && url.pathname === "/api/reports") {
      let body;
      try {
        body = await readJson(request);
      } catch (e) {
        return json(400, { error: "Invalid request" });
      }
      const phone = normalizeBdPhone(body.phone);
      if (!phone) return json(400, { error: "Enter a valid Bangladeshi mobile number" });
      let report;
      try {
        report = buildReport({ phone, reason: body.reason, note: body.note, shop: body.shop });
      } catch (e) {
        return json(400, { error: e.message });
      }
      await reports.add(report);
      return json(201, { ok: true, reports: await reports.forPhone(phone) });
    }

    return json(404, { error: "Not found" });
  }

  return {
    demo,
    couriers,
    async handle(request, { ip = "unknown" } = {}) {
      try {
        return await route(request, ip);
      } catch (e) {
        console.error(e);
        return json(500, { error: e.expose ? e.message : "Something went wrong" });
      }
    },
  };
}

module.exports = { createApi };
