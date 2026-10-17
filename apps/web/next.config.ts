import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // The app is fully client-side (public market data, local persistence), so it can also be
  // exported as static files and hosted anywhere: `STATIC_EXPORT=1 pnpm build`.
  ...(isStaticExport ? { output: "export" as const, images: { unoptimized: true }, trailingSlash: true } : {}),
  transpilePackages: ["@cv/core", "@cv/indicators", "@cv/signals", "@cv/risk", "@cv/backtest"],
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isStaticExport
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                { key: "X-Frame-Options", value: "DENY" },
                { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
