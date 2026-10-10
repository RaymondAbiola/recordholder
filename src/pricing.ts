// Prices the undisclosed shares from the issuer's own reference price.
//
// referencePrice is a PER SHARE price (the underlying's last close), which is what a
// share count must be multiplied by. tokenPrice is not usable here: the API derives it
// as referencePrice * tokenToShareRatio, so applying it to a share count would count the
// multiplier twice.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { formatUnits } from "viem";
import type { Sweep } from "./sweep";

export type RwaToken = {
  platformId: string;
  address: string;
  symbol: string;
  referencePrice: string | null;
};

export type RwaFile = { fetchedAt: string; chain: string; tokens: RwaToken[] };

export function loadRwa(): RwaFile | null {
  const path = join(process.cwd(), "data", "rwa-tokens.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RwaFile;
}

export type PricedHidden = {
  /** USD, at the issuer's reference price, for the securities it prices */
  value: number;
  pricedCount: number;
  divergentCount: number;
  /** divergent securities with no price available, largest undisclosed holding first */
  unpriced: { symbol: string; hiddenShares: number }[];
  fetchedAt: string;
};

export function pricedHidden(sweep: Sweep, rwa: RwaFile): PricedHidden {
  const ref = new Map(
    rwa.tokens
      .filter((t) => t.platformId === "bstock" && t.referencePrice !== null)
      .map((t) => [t.address.toLowerCase(), Number(t.referencePrice)])
  );

  let value = 0;
  let pricedCount = 0;
  const unpriced: PricedHidden["unpriced"] = [];

  for (const r of sweep.divergent) {
    const hidden = Number(formatUnits(r.hiddenSupply, r.decimals));
    const price = ref.get(r.address.toLowerCase());
    if (price && Number.isFinite(price)) {
      value += hidden * price;
      pricedCount++;
    } else {
      unpriced.push({ symbol: r.symbol, hiddenShares: hidden });
    }
  }

  unpriced.sort((a, b) => b.hiddenShares - a.hiddenShares);
  return { value, pricedCount, divergentCount: sweep.divergent.length, unpriced, fetchedAt: rwa.fetchedAt };
}
