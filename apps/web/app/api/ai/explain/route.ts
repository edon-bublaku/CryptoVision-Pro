import Anthropic from "@anthropic-ai/sdk";
import { env, log, rateLimit } from "@cv/server";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stable system prompt (no dates / ids) so it caches across requests.
const SYSTEM = `You are the analyst voice of CryptoVision Pro, a crypto technical-analysis tool.
You receive a JSON object produced by a deterministic analysis engine: a signal (action, 0-100 score, confidence, market regime, higher-timeframe bias, the strategy that confirmed a setup if any, the trade plan with entry, stop-loss and three targets, and the weighted factors behind the score), key support/resistance levels, the strategy's backtest statistics on this coin, and optionally derivatives positioning.

Explain that analysis to a retail trader. Rules that always apply:
- Use only the numbers in the JSON. Never invent prices, levels, probabilities or statistics, and never compute new ones beyond simple differences.
- Treat the output as probabilistic. Never say a trade is guaranteed, safe or certain, and never tell the reader what they must do with their money.
- If the backtest profit factor is below 1, or the signal status is WATCH, say plainly that the setup has not earned trust and why.
- Always state what would invalidate the idea (the stop-loss level and the opposing level).
- If the higher-timeframe bias opposes the trade direction, call it out.

Write in the language given by "locale" ("sq" = Albanian, "en" = English). Use short Markdown sections with these headings (translated): Summary, Why, Risks, Plan, Invalidation. Keep it under 300 words. End with a one-line reminder that this is not financial advice.`;

const input = z.object({
  locale: z.enum(["sq", "en"]).default("sq"),
  depth: z.enum(["quick", "deep"]).default("quick"),
  symbol: z.string().regex(/^[A-Z0-9]{2,20}$/),
  timeframe: z.string().max(4),
  signal: z.record(z.string(), z.unknown()),
  levels: z.array(z.object({ price: z.number(), kind: z.string(), touches: z.number() })).max(12).default([]),
  backtest: z.record(z.string(), z.unknown()).nullable().default(null),
  derivatives: z.record(z.string(), z.unknown()).nullable().default(null),
});

let client: Anthropic | null = null;

/**
 * Streams a plain-language explanation of an engine signal. The model only explains numbers the
 * deterministic engine computed (CLAUDE.md §4.6); it does not generate trade levels.
 */
export const POST = route({ noDb: true, rate: 20 }, async ({ req, ip, user }) => {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) throw new HttpError(503, "ai_disabled", "AI explanations are not configured");
  const rl = await rateLimit(`ai:${user?.id ?? ip}`, user ? 30 : 5, 3600);
  if (!rl.ok) throw new HttpError(429, "rate_limited", "AI quota reached", { retryAfter: rl.retryAfterSec });
  const data = await body(req, input);
  // Strip bulky fields the model doesn't need.
  const signal = { ...data.signal, factors: Array.isArray(data.signal.factors) ? (data.signal.factors as unknown[]).slice(0, 12) : [] };

  client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });
  const stream = client.beta.messages.stream({
    model: e.AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: data.depth === "deep" ? "high" : "low" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify({ locale: data.locale, symbol: data.symbol, timeframe: data.timeframe, signal, levels: data.levels, backtest: data.backtest, derivatives: data.derivatives }) }],
  });

  const enc = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") controller.enqueue(enc.encode(event.delta.text));
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(enc.encode(data.locale === "sq" ? "\n\n_Shpjegimi nuk mund të gjenerohej për këtë kërkesë._" : "\n\n_The explanation could not be generated for this request._"));
        if (final.stop_reason === "max_tokens") controller.enqueue(enc.encode("…"));
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) controller.enqueue(enc.encode("\n\n[AI rate limited — try again shortly]"));
        else if (err instanceof Anthropic.APIError) {
          log.warn({ status: err.status, msg: err.message }, "ai explain failed");
          controller.enqueue(enc.encode(`\n\n[AI error ${err.status ?? ""}]`));
        } else {
          log.error({ err: String(err) }, "ai explain failed");
          controller.enqueue(enc.encode("\n\n[AI error]"));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
  return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
