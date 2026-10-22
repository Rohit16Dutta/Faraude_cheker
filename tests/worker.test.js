const test = require("node:test");
const assert = require("node:assert/strict");

// A stand-in for a Workers KV namespace.
function fakeKv() {
  const data = new Map();
  return {
    async get(key, type) {
      const v = data.get(key);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

async function loadWorker() {
  // Fresh copy each time: the worker keeps its API instance per isolate.
  return (await import(`../worker.mjs?t=${Date.now()}${Math.random()}`)).default;
}

test("worker serves static assets through the ASSETS binding", async () => {
  const worker = await loadWorker();
  const env = { DEMO_MODE: "1", ASSETS: { fetch: async () => new Response("asset ok") } };
  const res = await worker.fetch(new Request("https://example.com/"), env);
  assert.equal(await res.text(), "asset ok");
});

test("worker runs lookups and stores reports in KV", async () => {
  const worker = await loadWorker();
  const env = { DEMO_MODE: "1", REPORTS: fakeKv(), ASSETS: { fetch: async () => new Response("") } };
  const post = (body) => worker.fetch(new Request("https://example.com/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);

  const check = await worker.fetch(new Request("https://example.com/api/check?phone=01712345678"), env);
  assert.equal(check.status, 200);
  assert.equal((await check.json()).couriers.length, 5);

  assert.equal((await post({ phone: "01712345678", reason: "refused" })).status, 201);
  assert.equal((await post({ phone: "01712345678", reason: "fake_order" })).status, 201);
  const after = await (await worker.fetch(new Request("https://example.com/api/check?phone=01712345678"), env)).json();
  assert.equal(after.reports.length, 2);
  assert.equal(after.overall.level, "high");
});

test("worker explains when the KV binding is missing", async () => {
  const worker = await loadWorker();
  const env = { DEMO_MODE: "1", ASSETS: { fetch: async () => new Response("") } };
  const res = await worker.fetch(new Request("https://example.com/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "01712345678", reason: "refused" }),
  }), env);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /REPORTS KV binding/);
});

test("worker enforces the access key", async () => {
  const worker = await loadWorker();
  const env = { DEMO_MODE: "1", ACCESS_KEY: "secret", ASSETS: { fetch: async () => new Response("") } };
  const url = "https://example.com/api/check?phone=01712345678";
  assert.equal((await worker.fetch(new Request(url), env)).status, 401);
  assert.equal((await worker.fetch(new Request(url, { headers: { "X-Access-Key": "secret" } }), env)).status, 200);
});
