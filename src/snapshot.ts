import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Sweep, SweepRow } from "./sweep.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");

export const SWEEP_PATH = join(dataDir, "sweep.json");

/** JSON has no bigint, so the snapshot stores them as decimal strings. */
export function loadSweep(): Sweep | null {
  if (!existsSync(SWEEP_PATH)) return null;
  const raw = JSON.parse(readFileSync(SWEEP_PATH, "utf8")) as unknown as Record<string, any>;

  const row = (r: Record<string, any>): SweepRow => ({
    symbol: r.symbol,
    underlying: r.underlying,
    address: r.address,
    decimals: r.decimals,
    uiMultiplier: BigInt(r.uiMultiplier),
    deviationBps: r.deviationBps,
    totalSupply: BigInt(r.totalSupply),
    totalSupplyUI: BigInt(r.totalSupplyUI),
    hiddenSupply: BigInt(r.hiddenSupply),
    pending: r.pending
      ? { multiplier: BigInt(r.pending.multiplier), effectiveAt: BigInt(r.pending.effectiveAt) }
      : null,
  });

  const rows = (raw.rows as Record<string, any>[]).map(row);
  const byAddress = new Map(rows.map((r) => [r.address, r]));
  const pick = (xs: Record<string, any>[]) =>
    xs.map((x) => byAddress.get(x.address)).filter((r): r is SweepRow => r !== undefined);

  return {
    blockNumber: BigInt(raw.blockNumber),
    timestamp: BigInt(raw.timestamp),
    rows,
    divergent: pick(raw.divergent),
    pending: pick(raw.pending),
    hiddenShareCount: BigInt(raw.hiddenShareCount),
    elapsedMs: raw.elapsedMs,
    rpcCalls: raw.rpcCalls,
  };
}
