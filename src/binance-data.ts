import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { formatUnits } from "viem";
import { loadSweep } from "./snapshot";

export type BalanceRow = {
  symbol: string;
  underlying: string;
  address: string;
  chainRaw: string;
  chainShares: string;
  apiBalance: string | null;
  apiRawBalance: string | null;
  apiTokenPrice: string | null;
};

export type BalancesCapture = {
  capturedAt: string;
  source: string;
  account: string;
  accountLabel: string;
  endpoint: string;
  tokensReturned: number;
  pages: number;
  elapsedMs: number;
  rows: BalanceRow[];
};

type RwaRow = {
  platformId: string;
  address: string;
  symbol: string;
  tokenToShareRatio: string | null;
  tokenPrice: string | null;
  referencePrice: string | null;
  marketStatus: string | null;
  openState: boolean | null;
};

const read = <T,>(name: string): T | null => {
  const path = join(process.cwd(), "data", name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
};

export const loadBalances = () => read<BalancesCapture>("binance-balances.json");

export type BinanceFindings = {
  fetchedAt: string;
  bstockListed: number;
  ondoListed: number;
  /** divergent tokens present in Binance's list, and how many carry exactly the on-chain multiplier */
  ratioCompared: number;
  ratioMatches: number;
  /** of those, how many have tokenPrice == referencePrice x tokenToShareRatio */
  priceCompared: number;
  priceIdentity: number;
  ratioByAddress: Map<string, string>;
  bstockOpen: number;
  bstockWithStatus: number;
  ondoStatus: [string, number][];
};

export function binanceFindings(): BinanceFindings | null {
  const rwa = read<{ fetchedAt: string; tokens: RwaRow[] }>("rwa-tokens.json");
  const sweep = loadSweep();
  if (!rwa || !sweep) return null;

  const bstock = rwa.tokens.filter((t) => t.platformId === "bstock");
  const ondo = rwa.tokens.filter((t) => t.platformId === "ondo");
  const listed = new Map(bstock.map((t) => [t.address.toLowerCase(), t]));

  let ratioCompared = 0, ratioMatches = 0, priceCompared = 0, priceIdentity = 0;
  for (const r of sweep.divergent) {
    const t = listed.get(r.address.toLowerCase());
    if (!t || !t.tokenToShareRatio) continue;
    const m = Number(formatUnits(r.uiMultiplier, 18));
    const ratio = Number(t.tokenToShareRatio);
    ratioCompared++;
    if (Math.abs(ratio - m) / m < 1e-12) ratioMatches++;
    const tp = Number(t.tokenPrice), rp = Number(t.referencePrice);
    if (tp && rp) {
      priceCompared++;
      if (Math.abs(tp - rp * ratio) / tp < 1e-9) priceIdentity++;
    }
  }

  const ondoStatus = new Map<string, number>();
  for (const t of ondo) ondoStatus.set(t.marketStatus ?? "unknown", (ondoStatus.get(t.marketStatus ?? "unknown") ?? 0) + 1);

  return {
    fetchedAt: rwa.fetchedAt,
    bstockListed: bstock.length,
    ondoListed: ondo.length,
    ratioCompared,
    ratioMatches,
    priceCompared,
    priceIdentity,
    ratioByAddress: new Map(
      bstock.filter((t) => t.tokenToShareRatio).map((t) => [t.address.toLowerCase(), t.tokenToShareRatio!])
    ),
    bstockOpen: bstock.filter((t) => t.openState === true).length,
    bstockWithStatus: bstock.filter((t) => t.marketStatus).length,
    ondoStatus: [...ondoStatus.entries()].sort((a, b) => b[1] - a[1]),
  };
}


export type QuoteRoute = {
  vendor: string;
  mode: string;
  best: boolean;
  tokensOut: number | null;
  effectivePrice: number | null;
  vsReferenceBps: number | null;
  reportedImpactPct: string | null;
};
export type QuoteRow = { symbol: string; sizeUsd: number; ms: number; ok: boolean; error?: string; routes: QuoteRoute[] };
export type QuotesCapture = { capturedAt: string; note: string; rows: QuoteRow[] };

export const loadQuotes = () => read<QuotesCapture>("binance-quotes.json");

export type QuoteSummary = {
  capturedAt: string;
  sizes: number[];
  tokens: {
    symbol: string;
    /** effective price of the smallest order against the issuer's per-token price, in bps */
    baselineBps: number | null;
    /** extra cost of each size over the smallest order, in bps of price */
    extraBps: Record<number, number | null>;
    /** the figure Binance labels price impact, for the largest order, as returned */
    reportedAtLargest: string | null;
  }[];
  medianMs: number;
  minMs: number;
  maxMs: number;
  quotes: number;
  vendors: string[];
  maxRoutesPerQuote: number;
};

export function summariseQuotes(q: QuotesCapture): QuoteSummary {
  const sizes = [...new Set(q.rows.map((r) => r.sizeUsd))].sort((a, b) => a - b);
  const symbols = [...new Set(q.rows.map((r) => r.symbol))];
  const ms = q.rows.map((r) => r.ms).sort((a, b) => a - b);
  const first = (sym: string, size: number) => q.rows.find((r) => r.symbol === sym && r.sizeUsd === size)?.routes[0];

  return {
    capturedAt: q.capturedAt,
    sizes,
    tokens: symbols.map((symbol) => {
      const base = first(symbol, sizes[0]!);
      const extraBps: Record<number, number | null> = {};
      for (const size of sizes) {
        const r = first(symbol, size);
        extraBps[size] = base?.effectivePrice && r?.effectivePrice ? (r.effectivePrice / base.effectivePrice - 1) * 1e4 : null;
      }
      return {
        symbol,
        baselineBps: base?.vsReferenceBps ?? null,
        extraBps,
        reportedAtLargest: first(symbol, sizes[sizes.length - 1]!)?.reportedImpactPct ?? null,
      };
    }),
    medianMs: ms[Math.floor(ms.length / 2)] ?? 0,
    minMs: ms[0] ?? 0,
    maxMs: ms[ms.length - 1] ?? 0,
    quotes: ms.length,
    vendors: [...new Set(q.rows.flatMap((r) => r.routes.map((x) => `${x.vendor} (${x.mode})`)))],
    maxRoutesPerQuote: Math.max(0, ...q.rows.map((r) => r.routes.length)),
  };
}

/** Does the price carried in a balance row equal reference x ratio, i.e. the per-token price? */
export function valueCheck(cap: BalancesCapture, f: BinanceFindings) {
  const rwa = read<{ tokens: RwaRow[] }>("rwa-tokens.json");
  const byAddr = new Map((rwa?.tokens ?? []).filter((t) => t.platformId === "bstock").map((t) => [t.address.toLowerCase(), t]));
  let compared = 0, perToken = 0, worstPpm = 0;
  for (const r of cap.rows) {
    const t = byAddr.get(r.address.toLowerCase());
    const price = r.apiTokenPrice ? Number(r.apiTokenPrice) : NaN;
    const ref = t?.referencePrice ? Number(t.referencePrice) : NaN;
    const ratio = t?.tokenToShareRatio ? Number(t.tokenToShareRatio) : NaN;
    if (!(price > 0 && ref > 0 && ratio > 0)) continue;
    compared++;
    const ppm = Math.abs(price / (ref * ratio) - 1) * 1e6;
    worstPpm = Math.max(worstPpm, ppm);
    if (ppm < 1) perToken++;
  }
  void f;
  return { compared, perToken, worstPpm };
}
