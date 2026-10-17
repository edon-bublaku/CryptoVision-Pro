import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function timeAgo(ts: number, lang: "sq" | "en"): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (lang === "sq") {
    // CLDR's Albanian data renders terse forms like "-17 s", so spell it out.
    if (s < 60) return "tani";
    if (s < 3600) return `para ${Math.round(s / 60)} min`;
    if (s < 86400) return `para ${Math.round(s / 3600)} orësh`;
    return `para ${Math.round(s / 86400)} ditësh`;
  }
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (s < 60) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}

export function download(filename: string, content: string | Blob, type = "application/json") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
