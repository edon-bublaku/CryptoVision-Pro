import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/** Only the market-data hosts the browser actually talks to. */
const connectSrc = [
  "'self'",
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
  "wss://data-stream.binance.vision",
  "wss://stream.binance.com:9443",
  "https://api.alternative.me",
  "https://api.coingecko.com",
  "https://www.okx.com",
  "https://api.telegram.org",
].join(" ");

const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap script; React dev tooling needs eval.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}${dev ? " ws://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@cv/core", "@cv/indicators", "@cv/signals", "@cv/risk", "@cv/backtest", "@cv/exchange", "@cv/engine", "@cv/db", "@cv/server"],
  serverExternalPackages: ["pg", "ioredis", "web-push", "pino", "qrcode"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
};

export default nextConfig;
