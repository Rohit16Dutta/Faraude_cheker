"use strict";

const { request, CookieJar, CourierError, createSession, toInt } = require("../http");

const AUTH = "https://merchant.carrybee.com/api/auth";

module.exports = {
  id: "carrybee",
  name: "Carrybee",
  env: ["CARRYBEE_PHONE", "CARRYBEE_PASSWORD"],

  createClient({ env, fetch }) {
    // Carrybee's merchant panel uses NextAuth: csrf → credentials callback → session (holds the API token).
    const session = createSession(async () => {
      const jar = new CookieJar();
      const headers = { Referer: "https://merchant.carrybee.com/login" };
      const csrf = await request(fetch, `${AUTH}/csrf`, { jar, headers });
      const csrfToken = csrf.data && csrf.data.csrfToken;
      if (!csrfToken) throw new CourierError(`Could not start login (HTTP ${csrf.status})`);

      await request(fetch, `${AUTH}/callback/login`, {
        method: "POST",
        jar,
        headers,
        form: {
          phone: "+88" + env.CARRYBEE_PHONE.replace(/^\+?88/, ""),
          password: env.CARRYBEE_PASSWORD,
          csrfToken,
          callbackUrl: "https://merchant.carrybee.com/login",
        },
      });

      const s = await request(fetch, `${AUTH}/session`, { jar, headers });
      const token = s.data && s.data.accessToken;
      const businessId = s.data && s.data.user && s.data.user.selectedBusinessId;
      if (!token || !businessId) throw new CourierError("Login failed — check CARRYBEE_PHONE / CARRYBEE_PASSWORD");
      return { token, businessId };
    }, 55 * 60 * 1000);

    return {
      check: (phone) => session.run(async ({ token, businessId }) => {
        const url = `https://api-merchant.carrybee.com/api/v2/businesses/${encodeURIComponent(businessId)}/fraud-check/${phone}`;
        const r = await request(fetch, url, { token });
        if (r.status === 401) throw new CourierError("Session expired", { authExpired: true });
        if (!r.ok || !r.data || r.data.error) throw new CourierError(`Lookup failed (HTTP ${r.status})`);
        const d = r.data.data || {};
        const total = toInt(d.total_order);
        const cancel = Math.min(total, toInt(d.cancelled_order));
        return { total, success: total - cancel, cancel };
      }),
    };
  },
};
