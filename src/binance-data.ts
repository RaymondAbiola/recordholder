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
