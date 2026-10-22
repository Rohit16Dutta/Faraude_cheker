"use strict";

// Node server for running locally: serves public/ and hands /api/* to lib/api.js.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createApi } = require("./lib/api");
const { createFileReportStore } = require("./lib/report-store-file");

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function createApp({
  env = process.env,
  fetch = globalThis.fetch,
  reportsFile = path.join(__dirname, "data", "reports.json"),
} = {}) {
  const api = createApi({ env, fetch, reports: createFileReportStore(reportsFile) });

  function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    res.end(text);
  }

  async function handleApi(req, res) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://${req.headers.host || "localhost"}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? "half" : undefined,
    });
    const response = await api.handle(request, { ip: req.socket.remoteAddress || "unknown" });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed");
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch (e) {
      return sendText(res, 400, "Bad request");
    }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, "Forbidden");
    fs.readFile(file, (err, data) => {
      if (err) return sendText(res, 404, "Not found");
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res).catch((e) => {
        console.error(e);
        if (!res.headersSent) sendText(res, 500, "Something went wrong");
      });
    } else {
      serveStatic(req, res, url);
    }
  });
}

if (require.main === module) {
  try {
    process.loadEnvFile(path.join(__dirname, ".env"));
  } catch (e) {
    // .env is optional — settings can also come from the real environment.
  }
  const port = Number(process.env.PORT) || 3000;
  const server = createApp();
  server.listen(port, () => {
    const { createCouriers } = require("./lib/couriers");
    const configured = createCouriers({ env: process.env }).filter((c) => c.configured).map((c) => c.name);
    console.log(`Courier Check running at http://localhost:${port}`);
    if (process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true") console.log("DEMO_MODE is on — courier numbers are fake.");
    else console.log(`Couriers configured: ${configured.length ? configured.join(", ") : "none (add credentials to .env)"}`);
  });
}

module.exports = { createApp };
