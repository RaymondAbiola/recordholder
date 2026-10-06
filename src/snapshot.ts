import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Sweep, SweepRow } from "./sweep";
import type { MultiplierEvent, TokenHistory } from "./events";

// see the note in catalogue.ts on why this is cwd-relative
const dataDir = join(process.cwd(), "data");

export const SWEEP_PATH = join(dataDir, "sweep.json");
export const EVENTS_PATH = join(dataDir, "events.json");

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

export type EventsSnapshot = {
  generatedAt: string;
  headBlock: bigint;
  histories: TokenHistory[];
  events: MultiplierEvent[];
};

export function loadEvents(): EventsSnapshot | null {
  if (!existsSync(EVENTS_PATH)) return null;
  const raw = JSON.parse(readFileSync(EVENTS_PATH, "utf8")) as Record<string, any>;

  const event = (e: Record<string, any>): MultiplierEvent => ({
    symbol: e.symbol,
    underlying: e.underlying,
    address: e.address,
    fromMultiplier: BigInt(e.fromMultiplier),
    toMultiplier: BigInt(e.toMultiplier),
    stepBps: e.stepBps,
    block: BigInt(e.block),
    effectiveAt: BigInt(e.effectiveAt),
    scheduledAtBlock: e.scheduledAtBlock === null ? null : BigInt(e.scheduledAtBlock),
    scheduledAt: e.scheduledAt === null ? null : BigInt(e.scheduledAt),
    noticeSeconds: e.noticeSeconds,
  });

  return {
    generatedAt: raw.generatedAt,
    headBlock: BigInt(raw.headBlock),
    histories: (raw.histories as Record<string, any>[]).map((h) => ({
      symbol: h.symbol,
      address: h.address,
      firstSeenBlock: BigInt(h.firstSeenBlock),
      multiplierAtFirstSeen: BigInt(h.multiplierAtFirstSeen),
      events: (h.events as Record<string, any>[]).map(event),
      truncated: h.truncated,
    })),
    events: (raw.events as Record<string, any>[]).map(event),
  };
}
