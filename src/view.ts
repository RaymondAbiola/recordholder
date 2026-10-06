// View model assembly. Formatting and aggregation only, no markup, so the same
// numbers back the web pages, the JSON endpoint and the CSV export.

import { formatUnits } from "viem";
import { loadSweep, loadEvents } from "./snapshot";
import type { SweepRow } from "./sweep";
import type { MultiplierEvent } from "./events";
import type { WalletReport } from "./wallet";

export function amount(v: bigint, decimals = 18, places = 4): string {
  return Number(formatUnits(v, decimals)).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Never renders a nonzero quantity as zero. */
export function shareAmount(v: bigint, places = 6): string {
  if (v === 0n) return (0).toFixed(places);
  const asNumber = Number(formatUnits(v, 18));
  const floor = 10 ** -places;
  return asNumber < floor ? `<${floor.toFixed(places)}` : amount(v, 18, places);
}

export function bps(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

export function utcDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
}

export function utcDateTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace("T", " ").slice(0, 19);
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export type Overview = {
  asOf: { block: bigint; timestamp: bigint };
  tokenCount: number;
  divergentCount: number;
  hiddenShareCount: bigint;
  divergent: SweepRow[];
  pendingNow: SweepRow[];
  events: MultiplierEvent[];
  /** tokens already off 1.0 before our earliest observation, so history is unknown */
  truncatedSymbols: string[];
  notice: { min: number; median: number; max: number; count: number } | null;
  /** Venus's permitted price staleness on these same tokens, for comparison */
  oracleStalenessSeconds: number;
};

export const VENUS_STALENESS_SECONDS = 3900;

export function buildOverview(): Overview | null {
  const sweep = loadSweep();
  const events = loadEvents();
  if (!sweep) return null;

  const notices = (events?.events ?? [])
    .map((e) => e.noticeSeconds)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  return {
    asOf: { block: sweep.blockNumber, timestamp: sweep.timestamp },
    tokenCount: sweep.rows.length,
    divergentCount: sweep.divergent.length,
    hiddenShareCount: sweep.hiddenShareCount,
    divergent: sweep.divergent,
    pendingNow: sweep.pending,
    events: events?.events ?? [],
    truncatedSymbols: (events?.histories ?? []).filter((h) => h.truncated).map((h) => h.symbol),
    notice: notices.length
      ? {
          min: notices[0]!,
          median: notices[Math.floor(notices.length / 2)]!,
          max: notices[notices.length - 1]!,
          count: notices.length,
        }
      : null,
    oracleStalenessSeconds: VENUS_STALENESS_SECONDS,
  };
}

export type WalletView = {
  report: WalletReport;
  eventsTotal: number;
  /** events the account held through, oldest first */
  timeline: WalletReport["held"];
  holdsAnything: boolean;
  everPaid: boolean;
};

export function buildWalletView(report: WalletReport, eventsTotal: number): WalletView {
  return {
    report,
    eventsTotal,
    timeline: report.held,
    holdsAnything: report.positions.length > 0,
    everPaid: report.held.length > 0,
  };
}
