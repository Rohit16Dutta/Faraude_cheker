"use strict";

// To support a new courier, add a module with { id, name, env, createClient } and list it here.
const PROVIDERS = [
  require("./steadfast"),
  require("./pathao"),
  require("./redx"),
  require("./paperfly"),
  require("./carrybee"),
];

function isConfigured(provider, env) {
  return provider.env.every((key) => String(env[key] || "").trim() !== "");
}

// Fake but stable numbers per phone, so the UI can be tried without courier accounts.
function demoClient(provider) {
  return {
    async check(phone) {
      let h = 0;
      for (const ch of provider.id + phone) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const total = h % 4 === 0 ? 0 : h % 37;
      const cancel = Math.round(total * (((h >>> 8) % 100) / 100) * ((h >>> 4) % 3 === 0 ? 0.9 : 0.3));
      return { total, success: total - cancel, cancel };
    },
  };
}

// Builds one client per courier. Couriers without credentials are reported as "not configured".
function createCouriers({ env = process.env, fetch = globalThis.fetch, demo = false } = {}) {
  return PROVIDERS.map((p) => {
    const configured = demo || isConfigured(p, env);
    return {
      id: p.id,
      name: p.name,
      env: p.env,
      configured,
      demo,
      client: configured ? (demo ? demoClient(p) : p.createClient({ env, fetch })) : null,
    };
  });
}

// Guards against odd courier responses: whole, non-negative numbers with success + cancel <= total.
function sanitize({ total, success, cancel }) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const s = n(success);
  const c = Math.min(n(cancel), Math.max(0, n(total) - s));
  return { total: Math.max(n(total), s + c), success: s, cancel: c };
}

async function checkAll(couriers, phone, { timeoutMs = 20000 } = {}) {
  return Promise.all(couriers.map(async (c) => {
    const base = { id: c.id, name: c.name };
    if (!c.configured) return { ...base, status: "not_configured", error: `Set ${c.env.join(" and ")} to enable` };
    try {
      const stats = await Promise.race([
        c.client.check(phone),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), timeoutMs).unref()),
      ]);
      return { ...base, status: "ok", ...sanitize(stats) };
    } catch (e) {
      return { ...base, status: "error", error: e.message || "Lookup failed" };
    }
  }));
}

module.exports = { PROVIDERS, createCouriers, checkAll, isConfigured };
