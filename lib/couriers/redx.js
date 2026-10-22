"use strict";

const { request, CourierError, createSession, toInt } = require("../http");

module.exports = {
  id: "redx",
  name: "RedX",
  env: ["REDX_PHONE", "REDX_PASSWORD"],

  createClient({ env, fetch }) {
    const session = createSession(async () => {
      const r = await request(fetch, "https://api.redx.com.bd/v4/auth/login", {
        method: "POST",
        json: { phone: "88" + env.REDX_PHONE, password: env.REDX_PASSWORD },
      });
      const token = r.data && r.data.data && r.data.data.accessToken;
      if (!r.ok || !token) {
        throw new CourierError(`Login failed (HTTP ${r.status}) — check REDX_PHONE / REDX_PASSWORD. RedX may require OTP login.`);
      }
      return token;
    }, 50 * 60 * 1000);

    return {
      check: (phone) => session.run(async (token) => {
        const url = `https://redx.com.bd/api/redx_se/admin/parcel/customer-success-return-rate?phoneNumber=88${phone}`;
        const r = await request(fetch, url, { token });
        if (r.status === 401) throw new CourierError("Session expired", { authExpired: true });
        if (r.status === 429) throw new CourierError("Rate limited by RedX — try again in a minute");
        if (!r.ok || !r.data) throw new CourierError(`Lookup failed (HTTP ${r.status})`);
        const d = r.data.data || {};
        const total = toInt(d.totalParcels);
        const success = Math.min(total, toInt(d.deliveredParcels));
        return { total, success, cancel: total - success };
      }),
    };
  },
};
