const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBdPhone } = require("../lib/phone");
const { aggregate } = require("../lib/aggregate");
const { createCouriers, checkAll } = require("../lib/couriers");

// A fake fetch that answers from a list of [matcher, response] routes and records every call.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    for (const [match, respond] of routes) {
      if (url.includes(match)) {
        const r = typeof respond === "function" ? respond(url, init, calls) : respond;
        const headers = new Headers();
        for (const c of r.cookies || []) headers.append("set-cookie", c);
        if (r.location) headers.set("location", r.location);
        const body = r.text !== undefined ? r.text : JSON.stringify(r.json);
        return new Response(body, { status: r.status || 200, headers });
      }
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

function onlyCourier(id, env, fetch) {
  return createCouriers({ env, fetch }).map((c) => (c.id === id ? c : { ...c, configured: false }));
}

test("normalizeBdPhone accepts common formats and Bangla digits", () => {
  assert.equal(normalizeBdPhone("01712345678"), "01712345678");
  assert.equal(normalizeBdPhone("+880 1712-345678"), "01712345678");
  assert.equal(normalizeBdPhone("8801712345678"), "01712345678");
  assert.equal(normalizeBdPhone("০১৭১২৩৪৫৬৭৮"), "01712345678");
  assert.equal(normalizeBdPhone("01212345678"), null);
  assert.equal(normalizeBdPhone("0171234567"), null);
  assert.equal(normalizeBdPhone(""), null);
});

test("aggregate combines couriers and picks a risk level", () => {
  const ok = (total, success) => ({ status: "ok", total, success, cancel: total - success });
  const good = aggregate([ok(10, 9), ok(5, 5), { status: "not_configured" }]);
  assert.equal(good.level, "low");
  assert.equal(good.total, 15);
  assert.equal(good.successRate, 93.3);
  assert.equal(good.couriersChecked, 2);

  assert.equal(aggregate([ok(10, 6)]).level, "medium");
  assert.equal(aggregate([ok(10, 2)]).level, "high");
  assert.equal(aggregate([ok(0, 0)]).level, "new");
  assert.equal(aggregate([{ status: "error", error: "x" }]).level, "unknown");
});

test("merchant reports raise the risk level", () => {
  const ok = { status: "ok", total: 10, success: 10, cancel: 0 };
  assert.equal(aggregate([ok], [{}]).level, "medium");
  assert.equal(aggregate([ok], [{}, {}]).level, "high");
});

test("demo numbers are always sane", async () => {
  const couriers = createCouriers({ demo: true });
  for (let i = 0; i < 200; i++) {
    const phone = "017" + String(10000000 + i * 7919).slice(-8);
    for (const r of await checkAll(couriers, phone)) {
      assert.ok(r.success >= 0 && r.cancel >= 0 && r.success + r.cancel === r.total, `${phone} ${JSON.stringify(r)}`);
    }
  }
});

test("courier results are clamped to sane numbers", async () => {
  const couriers = [{ id: "x", name: "X", configured: true, client: { check: async () => ({ total: 2, success: 5, cancel: -1 }) } }];
  const [r] = await checkAll(couriers, "01712345678");
  assert.deepEqual({ total: r.total, success: r.success, cancel: r.cancel }, { total: 5, success: 5, cancel: 0 });
});

test("unconfigured couriers are skipped automatically", async () => {
  const couriers = createCouriers({ env: { PATHAO_USER: "a" }, fetch: fakeFetch([]) });
  assert.ok(couriers.every((c) => !c.configured));
  const results = await checkAll(couriers, "01712345678");
  assert.ok(results.every((r) => r.status === "not_configured"));
});

test("Pathao: logs in once, then reads delivery stats", async () => {
  const fetch = fakeFetch([
    ["/api/v1/login", { json: { access_token: "tok" } }],
    ["/api/v1/user/success", { json: { data: { customer: { total_delivery: 12, successful_delivery: 9 } } } }],
  ]);
  const couriers = onlyCourier("pathao", { PATHAO_USER: "u", PATHAO_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "pathao");
  assert.deepEqual({ status: r.status, total: r.total, success: r.success, cancel: r.cancel }, { status: "ok", total: 12, success: 9, cancel: 3 });
  assert.equal(fetch.calls[1].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(fetch.calls[1].init.body), { phone: "01712345678" });

  await checkAll(couriers, "01812345678");
  assert.equal(fetch.calls.filter((c) => c.url.includes("/login")).length, 1, "token is reused");
});

test("Pathao: re-logs in once when the token has expired", async () => {
  let lookups = 0;
  const fetch = fakeFetch([
    ["/api/v1/login", { json: { access_token: "tok" } }],
    ["/api/v1/user/success", () => (++lookups === 1 ? { status: 401, json: {} } : { json: { data: { customer: { total_delivery: 1, successful_delivery: 1 } } } })],
  ]);
  const couriers = onlyCourier("pathao", { PATHAO_USER: "u", PATHAO_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "pathao");
  assert.equal(r.status, "ok");
  assert.equal(fetch.calls.filter((c) => c.url.includes("/login")).length, 2);
});

test("Pathao: bad credentials become a readable error", async () => {
  const fetch = fakeFetch([["/api/v1/login", { status: 401, json: { message: "bad" } }]]);
  const couriers = onlyCourier("pathao", { PATHAO_USER: "u", PATHAO_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "pathao");
  assert.equal(r.status, "error");
  assert.match(r.error, /PATHAO_USER/);
});

test("Steadfast: logs in with CSRF token and session cookie", async () => {
  const fetch = fakeFetch([
    ["/user/frauds/check/", (url, init) => {
      assert.match(init.headers.Cookie, /steadfast_session=logged-in/);
      return { json: { total_delivered: 7, total_cancelled: 3 } };
    }],
    ["/login", (url, init) => init.method === "POST"
      ? (assert.match(init.body, /_token=abc/), { status: 302, location: "https://steadfast.com.bd/dashboard", cookies: ["steadfast_session=logged-in; path=/"] })
      : { text: '<input type="hidden" name="_token" value="abc">', cookies: ["steadfast_session=guest; path=/"] }],
  ]);
  const couriers = onlyCourier("steadfast", { STEADFAST_USER: "u", STEADFAST_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "steadfast");
  assert.deepEqual({ status: r.status, total: r.total, success: r.success, cancel: r.cancel }, { status: "ok", total: 10, success: 7, cancel: 3 });
});

test("Steadfast: redirect back to the login page means wrong password", async () => {
  const fetch = fakeFetch([
    ["/login", (url, init) => init.method === "POST"
      ? { status: 302, location: "https://steadfast.com.bd/login" }
      : { text: '<input type="hidden" name="_token" value="abc">' }],
  ]);
  const couriers = onlyCourier("steadfast", { STEADFAST_USER: "u", STEADFAST_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "steadfast");
  assert.equal(r.status, "error");
  assert.match(r.error, /Login failed/);
});

test("RedX: sends 88-prefixed numbers and reads parcel counts", async () => {
  const fetch = fakeFetch([
    ["/v4/auth/login", (url, init) => {
      assert.equal(JSON.parse(init.body).phone, "8801900000000");
      return { json: { data: { accessToken: "rtok" } } };
    }],
    ["customer-success-return-rate", (url) => {
      assert.match(url, /phoneNumber=8801712345678$/);
      return { json: { data: { totalParcels: 4, deliveredParcels: 1 } } };
    }],
  ]);
  const couriers = onlyCourier("redx", { REDX_PHONE: "01900000000", REDX_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "redx");
  assert.deepEqual({ total: r.total, success: r.success, cancel: r.cancel }, { total: 4, success: 1, cancel: 3 });
});

test("Paperfly: counts parcels by status", async () => {
  const fetch = fakeFetch([
    ["login_using_password", { json: { token: "ptok" } }],
    ["smart-check/list", { json: { totalRecords: 4, records: [{ status: "Delivered" }, { status: "Returned" }, { status: "delivered" }, { status: "In transit" }] } }],
  ]);
  const couriers = onlyCourier("paperfly", { PAPERFLY_USER: "u", PAPERFLY_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "paperfly");
  assert.deepEqual({ total: r.total, success: r.success, cancel: r.cancel }, { total: 4, success: 2, cancel: 1 });
});

test("Carrybee: NextAuth login then business-scoped fraud check", async () => {
  const fetch = fakeFetch([
    ["/api/auth/csrf", { json: { csrfToken: "c1" }, cookies: ["next-auth.csrf-token=c1; path=/"] }],
    ["/api/auth/callback/login", { status: 302, location: "/", cookies: ["next-auth.session-token=s1; path=/"] }],
    ["/api/auth/session", (url, init) => {
      assert.match(init.headers.Cookie, /session-token=s1/);
      return { json: { accessToken: "ctok", user: { selectedBusinessId: "b42" } } };
    }],
    ["/businesses/b42/fraud-check/01712345678", { json: { data: { total_order: 5, cancelled_order: 1, success_rate: 80 } } }],
  ]);
  const couriers = onlyCourier("carrybee", { CARRYBEE_PHONE: "01900000000", CARRYBEE_PASSWORD: "p" }, fetch);
  const [r] = (await checkAll(couriers, "01712345678")).filter((x) => x.id === "carrybee");
  assert.deepEqual({ status: r.status, total: r.total, success: r.success, cancel: r.cancel }, { status: "ok", total: 5, success: 4, cancel: 1 });
});

test("one courier failing doesn't block the others", async () => {
  const fetch = fakeFetch([
    ["merchant.pathao.com/api/v1/login", { json: { access_token: "tok" } }],
    ["/api/v1/user/success", { json: { data: { customer: { total_delivery: 3, successful_delivery: 3 } } } }],
    ["api.redx.com.bd", { status: 500, text: "boom" }],
  ]);
  const env = { PATHAO_USER: "u", PATHAO_PASSWORD: "p", REDX_PHONE: "01900000000", REDX_PASSWORD: "p" };
  const results = await checkAll(createCouriers({ env, fetch }), "01712345678");
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.equal(byId.pathao.status, "ok");
  assert.equal(byId.redx.status, "error");
  assert.equal(byId.steadfast.status, "not_configured");
  const overall = aggregate(results);
  assert.equal(overall.level, "low");
  assert.equal(overall.notes.length, 1);
});
