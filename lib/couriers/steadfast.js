"use strict";

const { request, CookieJar, CourierError, createSession, toInt } = require("../http");

const BASE = "https://steadfast.com.bd";

module.exports = {
  id: "steadfast",
  name: "Steadfast",
  env: ["STEADFAST_USER", "STEADFAST_PASSWORD"],

  createClient({ env, fetch }) {
    // Steadfast has no token API for this — log in to the merchant panel and keep the session cookie.
    const session = createSession(async () => {
      const jar = new CookieJar();
      const page = await request(fetch, `${BASE}/login`, { jar, headers: { Accept: "text/html" } });
      const m = page.text.match(/name="_token"\s+value="([^"]+)"/);
      if (!m) throw new CourierError(`Could not open the login page (HTTP ${page.status})`);

      const r = await request(fetch, `${BASE}/login`, {
        method: "POST",
        jar,
        form: { _token: m[1], email: env.STEADFAST_USER, password: env.STEADFAST_PASSWORD },
        headers: { Accept: "text/html" },
      });
      if (!r.redirected || /\/login\/?$/.test(r.location)) {
        throw new CourierError("Login failed — check STEADFAST_USER / STEADFAST_PASSWORD");
      }
      return jar;
    }, 30 * 60 * 1000);

    return {
      check: (phone) => session.run(async (jar) => {
        const r = await request(fetch, `${BASE}/user/frauds/check/${phone}`, { jar });
        if (r.redirected || r.status === 401 || r.status === 419) {
          throw new CourierError("Session expired", { authExpired: true });
        }
        if (!r.ok || !r.data || typeof r.data !== "object") throw new CourierError(`Lookup failed (HTTP ${r.status})`);
        const success = toInt(r.data.total_delivered);
        const cancel = toInt(r.data.total_cancelled);
        return { total: success + cancel, success, cancel };
      }),
    };
  },
};
