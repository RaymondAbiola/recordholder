import type { Address, PublicClient } from "viem";
import { bep677Abi } from "./abi.js";
import { deviationBps, toUIAmount } from "./bep677.js";
import { loadCatalogue, type CatalogueToken } from "./catalogue.js";

export type SweepRow = {
  symbol: string;
  underlying: string;
  address: Address;
  decimals: number;
  uiMultiplier: bigint;
  deviationBps: number;
  /** what balanceOf-based tooling reports */
  totalSupply: bigint;
  /** shares actually outstanding */
  totalSupplyUI: bigint;
  hiddenSupply: bigint;
  pending: { multiplier: bigint; effectiveAt: bigint } | null;
};

export type Sweep = {
  blockNumber: bigint;
  timestamp: bigint;
  rows: SweepRow[];
  divergent: SweepRow[];
  pending: SweepRow[];
  /**
   * Sum of hiddenSupply across tokens. This is a COUNT of shares, not a value:
   * a hidden NVDA share and a hidden Nokia share are both one share and are not
   * interchangeable. Pricing happens separately.
   */
  hiddenShareCount: bigint;
  elapsedMs: number;
  rpcCalls: number;
};

const CALLS_PER_TOKEN = 5;
const CHUNK = 40;

const chunk = <T,>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function sweep(
  client: PublicClient,
  tokens: readonly CatalogueToken[] = loadCatalogue().tokens
): Promise<Sweep> {
  const started = Date.now();
  const block = await client.getBlock();
  let rpcCalls = 1;

  const rows: SweepRow[] = [];

  for (const batch of chunk(tokens, CHUNK)) {
    const res = await client.multicall({
      contracts: batch.flatMap((t) => [
        { address: t.address, abi: bep677Abi, functionName: "uiMultiplier" },
        { address: t.address, abi: bep677Abi, functionName: "totalSupply" },
        { address: t.address, abi: bep677Abi, functionName: "totalSupplyUI" },
        { address: t.address, abi: bep677Abi, functionName: "hasPendingMultiplier" },
        { address: t.address, abi: bep677Abi, functionName: "pendingMultiplier" },
      ] as const),
    });
    rpcCalls += 1;

    batch.forEach((t, i) => {
      const slice = res.slice(i * CALLS_PER_TOKEN, i * CALLS_PER_TOKEN + CALLS_PER_TOKEN);
      const [mult, supply, supplyUI, hasPending, pendingTuple] = slice;

      if (mult?.status !== "success" || supply?.status !== "success") {
        throw new Error(`${t.symbol} (${t.address}) failed core reads`);
      }

      const uiMultiplier = mult.result as bigint;
      const totalSupply = supply.result as bigint;

      const totalSupplyUI =
        supplyUI?.status === "success"
          ? (supplyUI.result as bigint)
          : toUIAmount(totalSupply, uiMultiplier);

      let pending: SweepRow["pending"] = null;
      if (hasPending?.status === "success" && hasPending.result === true && pendingTuple?.status === "success") {
        const [multiplier, effectiveAt] = pendingTuple.result as readonly [bigint, bigint];
        pending = { multiplier, effectiveAt };
      }

      rows.push({
        symbol: t.symbol,
        underlying: t.underlying,
        address: t.address,
        decimals: t.decimals,
        uiMultiplier,
        deviationBps: deviationBps(uiMultiplier),
        totalSupply,
        totalSupplyUI,
        hiddenSupply: totalSupplyUI - totalSupply,
        pending,
      });
    });
  }

  rows.sort((a, b) => b.deviationBps - a.deviationBps || a.symbol.localeCompare(b.symbol));

  const divergent = rows.filter((r) => r.uiMultiplier !== 10n ** 18n);

  return {
    blockNumber: block.number,
    timestamp: block.timestamp,
    rows,
    divergent,
    pending: rows.filter((r) => r.pending !== null),
    hiddenShareCount: rows.reduce((acc, r) => acc + r.hiddenSupply, 0n),
    elapsedMs: Date.now() - started,
    rpcCalls,
  };
}
