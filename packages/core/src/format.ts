/** Number of decimals that keeps ~5 significant digits for any crypto price. */
export function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (abs === 0 || !Number.isFinite(abs)) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  // Up to 16 decimals so sub-1e-6 prices (e.g. 1.234e-9) still keep their significant digits.
  return Math.min(16, Math.max(4, Math.ceil(-Math.log10(abs)) + 4));
}

/** Quantity with ~5 significant digits, so 0.00004 BTC doesn't collapse to "0.0000". */
export function formatQty(q: number): string {
  if (!Number.isFinite(q)) return "—";
  const abs = Math.abs(q);
  const decimals = abs === 0 ? 0 : abs >= 1000 ? 2 : abs >= 1 ? 4 : Math.min(12, Math.ceil(-Math.log10(abs)) + 4);
  return q.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
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
  // Values that round to zero print as 0.00%, never "-0.00%".
  const rounded = Number(v.toFixed(digits));
  const s = (rounded === 0 ? 0 : rounded).toFixed(digits);
  return `${signed && rounded > 0 ? "+" : ""}${s}%`;
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
  // Pick the unit after rounding, so 999,999 reads 1.00M and not 1000.00K.
  for (const [n, u] of units) if (Number(abs.toFixed(2)) >= n * 0.999995) return `${(v / n).toFixed(2)}${u}`;
  return v.toFixed(2);
}

export function baseAsset(symbol: string): string {
  return symbol.replace(/(USDT|USDC|FDUSD|BUSD)$/, "");
}
