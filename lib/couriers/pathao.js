"use strict";

const { request, CourierError, createSession, toInt } = require("../http");

const BASE = "https://merchant.pathao.com/api/v1";

module.exports = {
  id: "pathao",
  name: "Pathao",
  env: ["PATHAO_USER", "PATHAO_PASSWORD"],

  createClient({ env, fetch }) {
    const session = createSession(async () => {
      const r = await request(fetch, `${BASE}/login`, {
        method: "POST",
        json: { username: env.PATHAO_USER, password: env.PATHAO_PASSWORD },
      });
      const token = r.data && r.data.access_token;
      if (!r.ok || !token) throw new CourierError(`Login failed (HTTP ${r.status}) — check PATHAO_USER / PATHAO_PASSWORD`);
      return token.trim();
    }, 50 * 60 * 1000);

    return {
      check: (phone) => session.run(async (token) => {
        const r = await request(fetch, `${BASE}/user/success`, { method: "POST", json: { phone }, token });
        if (r.status === 401) throw new CourierError("Session expired", { authExpired: true });
        if (!r.ok || !r.data) throw new CourierError(`Lookup failed (HTTP ${r.status})`);
        const c = (r.data.data && r.data.data.customer) || {};
        const total = toInt(c.total_delivery);
        const success = Math.min(total, toInt(c.successful_delivery));
        return { total, success, cancel: total - success };
      }),
    };
  },
};
