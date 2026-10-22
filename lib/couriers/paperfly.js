"use strict";

const { request, CourierError, createSession, toInt } = require("../http");

const BASE = "https://go-app.paperfly.com.bd/merchant/api/react";

module.exports = {
  id: "paperfly",
  name: "Paperfly",
  env: ["PAPERFLY_USER", "PAPERFLY_PASSWORD"],

  createClient({ env, fetch }) {
    const session = createSession(async () => {
      const r = await request(fetch, `${BASE}/authentication/login_using_password.php`, {
        method: "POST",
        json: { username: env.PAPERFLY_USER, password: env.PAPERFLY_PASSWORD },
      });
      const token = r.data && r.data.token;
      if (!r.ok || !token) throw new CourierError(`Login failed (HTTP ${r.status}) — check PAPERFLY_USER / PAPERFLY_PASSWORD`);
      return token;
    }, 55 * 60 * 1000);

    return {
      check: (phone) => session.run(async (token) => {
        const r = await request(fetch, `${BASE}/smart-check/list.php`, {
          method: "POST",
          json: { search_text: phone, limit: 50, page: 1 },
          token,
        });
        if (r.status === 401) throw new CourierError("Session expired", { authExpired: true });
        if (!r.ok || !r.data) throw new CourierError(`Lookup failed (HTTP ${r.status})`);

        // Paperfly returns individual parcels rather than a summary, so count them by status.
        const records = Array.isArray(r.data.records) ? r.data.records : [];
        let success = 0;
        let cancel = 0;
        for (const rec of records) {
          const status = String((rec && rec.status) || "").toLowerCase();
          if (/deliver|success/.test(status)) success++;
          else if (/return|cancel|fail/.test(status)) cancel++;
        }
        const total = Math.max(toInt(r.data.totalRecords), success + cancel);
        return { total, success, cancel };
      }),
    };
  },
};
