// Cloudflare Workers entry point. Static files in public/ are served by Workers Static Assets;
// everything else (the /api/* routes) reaches this handler.
import { createApi } from "./lib/api.js";
import { toPublic } from "./lib/reports.js";

// Merchant reports in Workers KV: one key per phone number holding that number's reports.
function createKvReportStore(kv) {
  if (!kv) {
    return {
      async forPhone() {
        return [];
      },
      async add() {
        const err = new Error("Reports are not set up on this deployment (missing REPORTS KV binding)");
        err.expose = true;
        throw err;
      },
    };
  }
  const key = (phone) => `reports:${phone}`;
  async function load(phone) {
    const list = await kv.get(key(phone), "json");
    return Array.isArray(list) ? list : [];
  }
  return {
    async forPhone(phone) {
      return (await load(phone)).map(toPublic);
    },
    async add(report) {
      const list = await load(report.phone);
      list.push(report);
      await kv.put(key(report.phone), JSON.stringify(list.slice(-50)));
    },
  };
}

// Built once per isolate so courier logins and cached results are reused between requests.
let api = null;

export default {
  async fetch(request, env) {
    if (!api) api = createApi({ env, reports: createKvReportStore(env.REPORTS) });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return api.handle(request, { ip: request.headers.get("cf-connecting-ip") || "unknown" });
    }
    return env.ASSETS.fetch(request);
  },
};
