/** Number of decimals that keeps ~5 significant digits for any crypto price. */
export function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (abs === 0 || !Number.isFinite(abs)) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return Math.min(10, Math.max(4, Math.ceil(-Math.log10(abs)) + 4));
}

export function formatPrice(price: number, decimals = priceDecimals(price)): string {
  if (!Number.isFinite(price)) return "—";
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPct(v: number, digits = 2, signed = true): string {
  if (!Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [n, u] of units) if (abs >= n) return `${(v / n).toFixed(2)}${u}`;
  return v.toFixed(2);
}

export function baseAsset(symbol: string): string {
  return symbol.replace(/(USDT|USDC|FDUSD|BUSD)$/, "");
}
