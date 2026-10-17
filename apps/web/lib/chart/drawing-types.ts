export const DRAWING_SCHEMA_VERSION = 1;

export type DrawingType =
  | "trendline"
  | "ray"
  | "extended"
  | "hline"
  | "hray"
  | "vline"
  | "channel"
  | "rect"
  | "ellipse"
  | "triangle"
  | "fib"
  | "fibext"
  | "pitchfork"
  | "long"
  | "short"
  | "measure"
  | "arrow"
  | "brush"
  | "text"
  | "path";

export type Tool = DrawingType | "cursor" | "crosshair";

export interface DrawingPoint {
  /** Unix seconds; may be fractional / beyond the last bar so drawings survive timeframe changes. */
  time: number;
  price: number;
}

export interface DrawingStyle {
  color: string;
  width: number;
  dash: "solid" | "dashed" | "dotted";
  fill: boolean;
  fillOpacity: number;
  text?: string;
  fontSize?: number;
  extendLeft?: boolean;
  extendRight?: boolean;
  /** Fibonacci levels shown (ratios). */
  fibLevels?: number[];
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  style: DrawingStyle;
  locked: boolean;
  visible: boolean;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}

/** Points to click to complete each tool; 0 = free-form (brush) or until double-click (path). */
export const POINTS_REQUIRED: Record<DrawingType, number> = {
  trendline: 2,
  ray: 2,
  extended: 2,
  hline: 1,
  hray: 1,
  vline: 1,
  channel: 3,
  rect: 2,
  ellipse: 2,
  triangle: 3,
  fib: 2,
  fibext: 3,
  pitchfork: 3,
  long: 2,
  short: 2,
  measure: 2,
  arrow: 2,
  brush: 0,
  text: 1,
  path: 0,
};

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];
export const DEFAULT_FIBEXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];

export const PALETTE = ["#4f8cff", "#16c784", "#f0475a", "#f5a524", "#a78bfa", "#22d3ee", "#f472b6", "#e7ebf3", "#8b95a8"];

export function defaultStyle(type: DrawingType): DrawingStyle {
  const base: DrawingStyle = { color: "#4f8cff", width: 2, dash: "solid", fill: false, fillOpacity: 0.12 };
  switch (type) {
    case "rect":
    case "ellipse":
    case "triangle":
      return { ...base, color: "#a78bfa", fill: true };
    case "fib":
      return { ...base, color: "#f5a524", width: 1, fibLevels: DEFAULT_FIB_LEVELS, fill: true, fillOpacity: 0.06 };
    case "fibext":
      return { ...base, color: "#22d3ee", width: 1, fibLevels: DEFAULT_FIBEXT_LEVELS };
    case "channel":
      return { ...base, fill: true, fillOpacity: 0.08 };
    case "hline":
    case "hray":
      return { ...base, color: "#f5a524", width: 1 };
    case "vline":
      return { ...base, color: "#8b95a8", width: 1, dash: "dashed" };
    case "text":
      return { ...base, color: "#e7ebf3", text: "Text", fontSize: 14 };
    case "measure":
      return { ...base, color: "#4f8cff", fill: true, fillOpacity: 0.12, width: 1 };
    case "brush":
      return { ...base, color: "#f472b6" };
    case "pitchfork":
      return { ...base, color: "#22d3ee", width: 1 };
    default:
      return base;
  }
}
