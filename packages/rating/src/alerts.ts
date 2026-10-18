import { PILLAR_IDS, WEIGHT_PRESETS, type PillarWeights, type PresetId } from "./rating";

/**
 * Pillar weights from a stored preset id, or the user's custom weights when the preset is
 * "custom". Anything malformed falls back to the balanced preset, so a corrupt settings
 * document can never turn alerts off silently.
 */
export function resolveWeights(preset: unknown, custom?: unknown): PillarWeights {
  if (preset === "custom" && custom && typeof custom === "object") {
    const c = custom as Record<string, unknown>;
    const w = Object.fromEntries(PILLAR_IDS.map((p) => [p, typeof c[p] === "number" && Number.isFinite(c[p]) && (c[p] as number) >= 0 ? c[p] : 0])) as PillarWeights;
    if (PILLAR_IDS.some((p) => w[p] > 0)) return w;
  }
  // Own keys only: "constructor" or "__proto__" must not resolve to Object.prototype members.
  return typeof preset === "string" && Object.hasOwn(WEIGHT_PRESETS, preset) ? WEIGHT_PRESETS[preset as PresetId] : WEIGHT_PRESETS.balanced;
}

export type RatingAlertType = "rating_above" | "rating_below";

/**
 * Edge-triggered: an alert fires when the score enters the zone (≥ / ≤ threshold) and re-arms
 * only after it leaves. `lastSide` is +1 inside the zone, −1 outside, undefined before the first
 * check — so an alert created while the coin is already in the zone fires once right away.
 * The daily rating moves slowly; level-triggered alerts would repeat on every run.
 */
export function checkRatingAlert(type: RatingAlertType, threshold: number, score: number, lastSide: -1 | 1 | null | undefined): { fire: boolean; side: -1 | 1 } {
  const inside = type === "rating_above" ? score >= threshold : score <= threshold;
  const side: -1 | 1 = inside ? 1 : -1;
  return { fire: inside && lastSide !== 1, side };
}
