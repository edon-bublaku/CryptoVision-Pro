import type { IChartApi, ISeriesApi, Logical, SeriesType } from "lightweight-charts";

/**
 * Converts between (time, price) and pixels. Time is mapped through fractional logical indices,
 * so a drawing anchored between bars, before the first bar or in the future still lands in the
 * right place — and keeps its position when the timeframe changes.
 */
export class CoordMapper {
  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<SeriesType>,
    private readonly times: () => readonly number[],
    private readonly tfSeconds: () => number,
  ) {}

  timeToLogical(t: number): number {
    const ts = this.times();
    const n = ts.length;
    const tf = this.tfSeconds();
    if (n === 0) return 0;
    if (t <= ts[0]!) return (t - ts[0]!) / tf;
    if (t >= ts[n - 1]!) return n - 1 + (t - ts[n - 1]!) / tf;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const a = ts[lo]!;
    const b = ts[hi]!;
    return lo + (b === a ? 0 : (t - a) / (b - a));
  }

  logicalToTime(l: number): number {
    const ts = this.times();
    const n = ts.length;
    const tf = this.tfSeconds();
    if (n === 0) return 0;
    if (l <= 0) return ts[0]! + l * tf;
    if (l >= n - 1) return ts[n - 1]! + (l - (n - 1)) * tf;
    const i = Math.floor(l);
    const f = l - i;
    return ts[i]! + f * (ts[i + 1]! - ts[i]!);
  }

  timeToX(t: number): number | null {
    const x = this.chart.timeScale().logicalToCoordinate(this.timeToLogical(t) as Logical);
    return x === null ? null : x;
  }

  xToTime(x: number): number | null {
    const l = this.chart.timeScale().coordinateToLogical(x);
    return l === null ? null : this.logicalToTime(l);
  }

  xToLogical(x: number): number | null {
    return this.chart.timeScale().coordinateToLogical(x);
  }

  priceToY(p: number): number | null {
    return this.series.priceToCoordinate(p);
  }

  yToPrice(y: number): number | null {
    return this.series.coordinateToPrice(y);
  }

  barSpacing(): number {
    return this.chart.timeScale().options().barSpacing;
  }
}
