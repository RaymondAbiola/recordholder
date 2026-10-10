// Serialisation for the JSON endpoint and the CSV export. Exact decimal strings from
// formatUnits, never floats: a quantity going into someone's tax records should not pass
// through a double. No framework imports, so this can be lifted out as is.

import { formatUnits } from "viem";
import type { WalletReport } from "./wallet";
import type { MultiplierEvent } from "./events";

const iso = (ts: bigint) => new Date(Number(ts) * 1000).toISOString();
const dec = (v: bigint, decimals = 18) => formatUnits(v, decimals);

export function eventToJson(e: MultiplierEvent) {
  return {
    symbol: e.symbol,
    underlying: e.underlying,
    token: e.address,
    effectiveAt: iso(e.effectiveAt),
    effectiveBlock: e.block.toString(),
    announcedBlock: e.scheduledAtBlock?.toString() ?? null,
    announcedAt: e.scheduledAt === null ? null : iso(e.scheduledAt),
    noticeSeconds: e.noticeSeconds,
    multiplierBefore: dec(e.fromMultiplier),
    multiplierAfter: dec(e.toMultiplier),
    stepBps: e.stepBps,
  };
}

export function walletToJson(r: WalletReport, eventsTotal: number) {
  return {
    account: r.account,
    note:
      "Shares credited by a multiplier change are not transfers: no transaction, event or " +
      "balanceOf change records them. Quantities only, no prices.",
    totals: {
      actionsHeldThrough: r.held.length,
      actionsRecorded: eventsTotal,
      sharesCredited: dec(r.sharesGainedTotal),
      sharesHiddenNow: dec(r.hiddenNow),
    },
    corporateActions: r.held.map((h) => ({
      ...eventToJson(h.event),
      rawBalanceBeforeEvent: dec(h.rawAtEvent),
      sharesCredited: dec(h.sharesGained),
      positionStillOpen: h.stillHeld,
    })),
    holdings: r.positions.map((p) => ({
      symbol: p.token.symbol,
      underlying: p.token.underlying,
      token: p.token.address,
      balanceOfReports: dec(p.raw, p.token.decimals),
      sharesOwned: dec(p.shares, p.token.decimals),
      difference: dec(p.hidden, p.token.decimals),
    })),
  };
}

// A cell starting with = + - or @ is executed as a formula by spreadsheet software.
// Token and company names come from a third-party listing, so neutralise them.
function cell(v: string | number | boolean | null): string {
  if (v === null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = [
  "effective_at_utc",
  "ticker",
  "security",
  "token_contract",
  "raw_balance_before_event",
  "multiplier_before",
  "multiplier_after",
  "shares_credited",
  "effective_block",
  "position_still_open",
];

export function walletToCsv(r: WalletReport): string {
  const rows = r.held.map((h) => [
    iso(h.event.effectiveAt),
    h.event.symbol,
    h.event.underlying,
    h.event.address,
    dec(h.rawAtEvent),
    dec(h.event.fromMultiplier),
    dec(h.event.toMultiplier),
    dec(h.sharesGained),
    h.event.block.toString(),
    h.stillHeld,
  ]);
  return `${[HEADER, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
