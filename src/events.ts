// Recovering corporate action history.
//
// BEP-677 history is only in logs, and no free BSC endpoint serves a wide enough
// eth_getLogs range to read it (see docs/devex-log.md). So this reconstructs the
// same information from historical eth_call instead: a coarse scan to locate the
// intervals where uiMultiplier changed, then a binary search inside each one.
//
// Two things make it affordable. Multicall3 works at a historical block, so the
// coarse scan costs one request per sampled block regardless of token count. And
// the per-token binary searches are independent, so they run concurrently.

import type { Address, PublicClient } from "viem";
import { bep677Abi } from "./abi.js";
import { WAD, deviationBps } from "./bep677.js";
import type { CatalogueToken } from "./catalogue.js";

export type MultiplierEvent = {
  symbol: string;
  underlying: string;
  address: Address;
  fromMultiplier: bigint;
  toMultiplier: bigint;
  /** size of the step, in basis points of the pre-event multiplier */
  stepBps: number;
  /** first block at which the new multiplier is active */
  block: bigint;
  /** that block's timestamp, which is the effectiveAt the issuer scheduled */
  effectiveAt: bigint;
  /** block at which the change was announced, via newUIMultiplier */
  scheduledAtBlock: bigint | null;
  scheduledAt: bigint | null;
  /** seconds of on-chain warning integrators had */
  noticeSeconds: number | null;
};

export type TokenHistory = {
  symbol: string;
  address: Address;
  /** earliest sampled block where the contract answered */
  firstSeenBlock: bigint;
  /** multiplier at that block; 1e18 means we caught it before any corporate action */
  multiplierAtFirstSeen: bigint;
  events: MultiplierEvent[];
  /** true when the first observation was already off 1.0, so earlier history is unknown */
  truncated: boolean;
};

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    })
  );
  return out;
}

async function multiplierAt(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
  fn: "uiMultiplier" | "newUIMultiplier" = "uiMultiplier"
): Promise<bigint | null> {
  try {
    return await client.readContract({ address, abi: bep677Abi, functionName: fn, blockNumber });
  } catch {
    // contract not deployed yet at this height, or the node refused the read
    return null;
  }
}

/** uiMultiplier for every token at one block, in a single request. */
export async function scanAtBlock(
  client: PublicClient,
  tokens: readonly CatalogueToken[],
  blockNumber: bigint
): Promise<(bigint | null)[]> {
  const res = await client.multicall({
    contracts: tokens.map((t) => ({
      address: t.address,
      abi: bep677Abi,
      functionName: "uiMultiplier" as const,
    })),
    blockNumber,
  });
  return res.map((r) => (r.status === "success" ? (r.result as bigint) : null));
}

/**
 * First block in (lo, hi] where the value reported by `fn` equals `target`,
 * given it does not at `lo` and does at `hi`.
 */
async function bisect(
  client: PublicClient,
  address: Address,
  lo: bigint,
  hi: bigint,
  target: bigint,
  fn: "uiMultiplier" | "newUIMultiplier"
): Promise<bigint> {
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const v = await multiplierAt(client, address, mid, fn);
    if (v === target) hi = mid;
    else lo = mid;
  }
  return hi;
}

export async function detectHistory(
  client: PublicClient,
  token: CatalogueToken,
  samples: { block: bigint; multiplier: bigint | null }[]
): Promise<TokenHistory> {
  const seen = samples.filter((s) => s.multiplier !== null) as { block: bigint; multiplier: bigint }[];
  if (seen.length === 0) {
    throw new Error(`${token.symbol}: no sampled block returned a multiplier`);
  }

  const first = seen[0]!;
  const events: MultiplierEvent[] = [];

  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1]!;
    const cur = seen[i]!;
    if (prev.multiplier === cur.multiplier) continue;

    const block = await bisect(client, token.address, prev.block, cur.block, cur.multiplier, "uiMultiplier");
    const blk = await client.getBlock({ blockNumber: block });

    // newUIMultiplier holds the incoming value from the moment it is announced,
    // so the first block reporting it is the announcement.
    let scheduledAtBlock: bigint | null = null;
    let scheduledAt: bigint | null = null;
    let noticeSeconds: number | null = null;
    const newAtPrev = await multiplierAt(client, token.address, prev.block, "newUIMultiplier");
    if (newAtPrev !== null && newAtPrev !== cur.multiplier) {
      scheduledAtBlock = await bisect(client, token.address, prev.block, block, cur.multiplier, "newUIMultiplier");
      const sblk = await client.getBlock({ blockNumber: scheduledAtBlock });
      scheduledAt = sblk.timestamp;
      noticeSeconds = Number(blk.timestamp - sblk.timestamp);
    }

    events.push({
      symbol: token.symbol,
      underlying: token.underlying,
      address: token.address,
      fromMultiplier: prev.multiplier,
      toMultiplier: cur.multiplier,
      stepBps: deviationBps((cur.multiplier * WAD) / prev.multiplier),
      block,
      effectiveAt: blk.timestamp,
      scheduledAtBlock,
      scheduledAt,
      noticeSeconds,
    });
  }

  return {
    symbol: token.symbol,
    address: token.address,
    firstSeenBlock: first.block,
    multiplierAtFirstSeen: first.multiplier,
    events,
    truncated: first.multiplier !== WAD,
  };
}
