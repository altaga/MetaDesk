/** Meta Model API list prices, in US dollars per 1M tokens. */

type Price = { input_per_m: number; output_per_m: number };

/** Mirrors the board defaults in apps/api (META_USD_PER_1M_INPUT / OUTPUT). */
const DEFAULT: Price = { input_per_m: 4.0, output_per_m: 20.0 };

const PRICES: Record<string, Price> = {
  "muse-spark-1.3": { input_per_m: 4.0, output_per_m: 20.0 },
  "muse-wonder-1.0": { input_per_m: 4.0, output_per_m: 20.0 },
  "muse-wonder-full-1.0": { input_per_m: 4.0, output_per_m: 20.0 },
};

export function priceOf(model: string): Price {
  return PRICES[model] ?? DEFAULT;
}

export function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceOf(model);
  return (promptTokens * p.input_per_m + completionTokens * p.output_per_m) / 1_000_000;
}
