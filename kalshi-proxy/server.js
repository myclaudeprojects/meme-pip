// Read-only CORS proxy for Kalshi KXBTC15M open markets. No keys, no writes.
"use strict";
const http = require("http");
const https = require("https");

const PORT = Number(process.env.PORT) || 10000;
const UPSTREAM = "https://api.elections.kalshi.com/trade-api/v2/markets";
const ALLOWED_SERIES = new Set(["KXBTC15M"]);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function send(res, code, body, type) {
  cors(res);
  res.statusCode = code;
  res.setHeader("Content-Type", type || "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function fetchUpstream(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: "application/json", "User-Agent": "kalshi-kxbtc15m-proxy/1" } }, (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve({ status: r.statusCode || 502, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(8000, () => { req.destroy(new Error("upstream timeout")); });
    req.on("error", reject);
  });
}

function parsePath(urlPath) {
  const q = urlPath.indexOf("?");
  return { path: q < 0 ? urlPath : urlPath.slice(0, q), search: q < 0 ? "" : urlPath.slice(q + 1) };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      cors(res);
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== "GET") return send(res, 405, JSON.stringify({ error: "method not allowed" }));

    const { path, search } = parsePath(req.url || "/");
    if (path === "/health" || path === "/") {
      return send(res, 200, JSON.stringify({ ok: true, service: "kalshi-kxbtc15m-proxy", series: "KXBTC15M" }));
    }

    // Preferred short route used by the dashboard.
    if (path === "/kxbtc15m" || path === "/markets") {
      const params = new URLSearchParams(search);
      const series = params.get("series_ticker") || "KXBTC15M";
      const status = params.get("status") || "open";
      if (!ALLOWED_SERIES.has(series)) {
        return send(res, 403, JSON.stringify({ error: "series not allowed", allowed: [...ALLOWED_SERIES] }));
      }
      // Only pass the two whitelisted query keys.
      const qs = new URLSearchParams({ series_ticker: series, status });
      const up = await fetchUpstream(UPSTREAM + "?" + qs.toString());
      cors(res);
      res.statusCode = up.status;
      res.setHeader("Content-Type", up.headers["content-type"] || "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.end(up.body);
    }

    return send(res, 404, JSON.stringify({ error: "not found", routes: ["/health", "/kxbtc15m", "/markets?series_ticker=KXBTC15M&status=open"] }));
  } catch (e) {
    send(res, 502, JSON.stringify({ error: "proxy failed", detail: String(e && e.message || e) }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("kalshi-kxbtc15m-proxy listening on " + PORT);
});
