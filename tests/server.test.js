const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

async function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fraud-checker-"));
  const server = createApp({ env, reportsFile: path.join(dir, "reports.json"), fetch: async () => { throw new Error("no network in tests"); } });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("serves the site and blocks path traversal", async (t) => {
  const app = await start({});
  t.after(app.close);
  const home = await fetch(`${app.base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Courier Check/);
  assert.equal((await fetch(`${app.base}/js/app.js`)).status, 200);
  assert.notEqual((await fetch(`${app.base}/..%2fserver.js`)).status, 200);
  assert.notEqual((await fetch(`${app.base}/..%2f.env.example`)).status, 200);
});

test("check validates the phone number", async (t) => {
  const app = await start({ DEMO_MODE: "1" });
  t.after(app.close);
  const r = await fetch(`${app.base}/api/check?phone=12345`);
  assert.equal(r.status, 400);
});

test("demo mode returns a full overall view", async (t) => {
  const app = await start({ DEMO_MODE: "1" });
  t.after(app.close);
  const r = await fetch(`${app.base}/api/check?phone=${encodeURIComponent("+880 1712-345678")}`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.phone, "01712345678");
  assert.equal(data.demo, true);
  assert.equal(data.couriers.length, 5);
  assert.ok(["low", "medium", "high", "new"].includes(data.overall.level));
  assert.equal(data.overall.total, data.couriers.reduce((s, c) => s + c.total, 0));
  for (const c of data.couriers) {
    assert.ok(c.success >= 0 && c.cancel >= 0 && c.success + c.cancel <= c.total, JSON.stringify(c));
  }
  assert.ok(data.overall.successRate === null || (data.overall.successRate >= 0 && data.overall.successRate <= 100));
});

test("without credentials every courier shows as not connected", async (t) => {
  const app = await start({});
  t.after(app.close);
  const data = await (await fetch(`${app.base}/api/check?phone=01712345678`)).json();
  assert.ok(data.couriers.every((c) => c.status === "not_configured"));
  assert.equal(data.overall.level, "unknown");
});

test("reports are saved and included in later checks", async (t) => {
  const app = await start({ DEMO_MODE: "1" });
  t.after(app.close);
  const post = (body) => fetch(`${app.base}/api/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await post({ phone: "01712345678", reason: "nonsense" })).status, 400);
  assert.equal((await post({ phone: "123", reason: "refused" })).status, 400);
  assert.equal((await post({ phone: "01712345678", reason: "refused", note: "Refused at the door", shop: "My Shop" })).status, 201);
  assert.equal((await post({ phone: "01712345678", reason: "fake_order" })).status, 201);

  const data = await (await fetch(`${app.base}/api/check?phone=01712345678`)).json();
  assert.equal(data.reports.length, 2);
  assert.equal(data.reports[0].reasonLabel, "Refused parcel");
  assert.equal(data.overall.level, "high");
});

test("ACCESS_KEY protects the API", async (t) => {
  const app = await start({ DEMO_MODE: "1", ACCESS_KEY: "secret" });
  t.after(app.close);
  assert.equal((await fetch(`${app.base}/api/check?phone=01712345678`)).status, 401);
  assert.equal((await fetch(`${app.base}/api/check?phone=01712345678`, { headers: { "X-Access-Key": "wrong" } })).status, 401);
  assert.equal((await fetch(`${app.base}/api/check?phone=01712345678`, { headers: { "X-Access-Key": "secret" } })).status, 200);
  assert.equal((await fetch(`${app.base}/`)).status, 200, "the page itself stays public");
});

test("rate limit kicks in", async (t) => {
  const app = await start({ DEMO_MODE: "1", RATE_LIMIT_PER_MINUTE: "2" });
  t.after(app.close);
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await fetch(`${app.base}/api/check?phone=01712345678`)).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});
