import {
  Bell,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarRange,
  Calculator,
  CandlestickChart,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  Orbit,
  Radar,
  Settings,
  Sparkles,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { TKey } from "@/lib/i18n";

export interface NavItem {
  href: string;
  key: TKey;
  icon: LucideIcon;
  /** Extra words the command palette matches on (both languages). */
  keywords?: string;
}

export interface NavGroup {
  key: TKey;
  items: NavItem[];
}

/** One source of truth for the sidebar, the mobile "More" sheet and the command palette. */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "navg.invest",
    items: [
      { href: "/", key: "nav.dashboard", icon: LayoutDashboard, keywords: "home panel dashboard" },
      { href: "/recommendations", key: "nav.recommendations", icon: Sparkles, keywords: "portfolio model rekomandime" },
      { href: "/rating", key: "nav.rating", icon: Gauge, keywords: "score cv rating vleresim" },
      { href: "/portfolio", key: "nav.portfolio", icon: BriefcaseBusiness, keywords: "positions paper pozicione" },
      { href: "/journal", key: "nav.journal", icon: BookOpenCheck, keywords: "journal ditar statistika win rate pnl performance" },
    ],
  },
  {
    key: "navg.analysis",
    items: [
      { href: "/chart", key: "nav.chart", icon: CandlestickChart, keywords: "grafik chart draw vizato" },
      { href: "/signals", key: "nav.signals", icon: Zap, keywords: "sinjale signals buy sell" },
      { href: "/screener", key: "nav.screener", icon: Radar, keywords: "skaner scan filter" },
      { href: "/markets", key: "nav.markets", icon: Orbit, keywords: "rrg correlation tregu" },
      { href: "/compare", key: "nav.compare", icon: GitCompareArrows, keywords: "compare krahaso vs" },
      { href: "/seasonality", key: "nav.seasonality", icon: CalendarRange, keywords: "seasonality sezonalitet muaj month weekday drawdown histori" },
    ],
  },
  {
    key: "navg.tools",
    items: [
      { href: "/backtest", key: "nav.backtest", icon: FlaskConical, keywords: "strategy builder backtest" },
      { href: "/tools", key: "nav.tools", icon: Calculator, keywords: "calculator kalkulator dca leverage liquidation" },
      { href: "/alerts", key: "nav.alerts", icon: Bell, keywords: "alert njoftime" },
    ],
  },
  {
    key: "navg.system",
    items: [
      { href: "/settings", key: "nav.settings", icon: Settings, keywords: "settings cilesime risk" },
      { href: "/account", key: "nav.account", icon: UserRound, keywords: "account llogari 2fa" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Always visible in the mobile bottom bar; everything else is one tap away in "More". */
export const MOBILE_PRIMARY = ["/", "/recommendations", "/chart", "/rating"];

export function isActive(path: string, href: string): boolean {
  return href === "/" ? path === "/" : path.startsWith(href);
}
