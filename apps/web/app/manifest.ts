import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CryptoVision Pro",
    short_name: "CryptoVision",
    description: "Analizë profesionale e kriptovalutave: sinjale, plane tregtie, backtest dhe grafik me vizatime.",
    start_url: "/",
    display: "standalone",
    background_color: "#060911",
    theme_color: "#060911",
    lang: "sq",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Grafiku", url: "/chart" },
      { name: "Sinjalet", url: "/signals" },
      { name: "Portofoli", url: "/portfolio" },
    ],
  };
}
