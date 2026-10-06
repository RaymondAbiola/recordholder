import { writeFileSync } from "node:fs";
import { formatUnits } from "viem";
import { archiveClient } from "../src/config";
import { loadCatalogue } from "../src/catalogue";
import { scanAtBlock, detectHistory, mapLimit, type TokenHistory } from "../src/events";
import { WAD } from "../src/bep677";
import { EVENTS_PATH } from "../src/snapshot";

// bStocks predates none of this; 112.5M is comfortably before the first listing.
const START = 112_500_000n;
const SAMPLES = 18;
const CONCURRENCY = 5;

const tokens = loadCatalogue().tokens;
const head = await archiveClient.getBlockNumber();
const started = Date.now();

const blocks = Array.from(
  { length: SAMPLES },
  (_, i) => START + ((head - START) * BigInt(i)) / BigInt(SAMPLES - 1)
);

console.log(`coarse scan: ${tokens.length} tokens x ${SAMPLES} blocks, batched per block`);
const grid: (bigint | null)[][] = [];
for (const [i, b] of blocks.entries()) {
  grid.push(await scanAtBlock(archiveClient, tokens, b));
  process.stdout.write(`  ${i + 1}/${SAMPLES}\r`);
}
console.log(`  ${SAMPLES}/${SAMPLES} done in ${Date.now() - started}ms, ${SAMPLES} requests`);

// only tokens whose sampled multiplier actually moves need a binary search
const needsSearch = tokens.filter((_, ti) => {
  const seen = grid.map((row) => row[ti]).filter((v) => v !== null);
  return new Set(seen.map(String)).size > 1;
});
console.log(`\n${needsSearch.length} tokens show a step between samples, bisecting those`);

const histories = await mapLimit(needsSearch, CONCURRENCY, async (t) => {
  const ti = tokens.indexOf(t);
  const samples = blocks.map((block, bi) => ({ block, multiplier: grid[bi]![ti]! }));
  const h = await detectHistory(archiveClient, t, samples);
  process.stdout.write(`  ${h.symbol} ${h.events.length} event(s)\n`);
  return h;
});

// tokens already divergent at the first sample carry history we cannot see
const truncatedNoSearch: TokenHistory[] = tokens
  .map((t, ti) => ({ t, ti }))
  .filter(({ ti }) => {
    const seen = grid.map((row) => row[ti]).filter((v) => v !== null) as bigint[];
    return seen.length > 0 && new Set(seen.map(String)).size === 1 && seen[0] !== WAD;
  })
  .map(({ t, ti }) => {
    const firstIdx = grid.findIndex((row) => row[ti] !== null);
    return {
      symbol: t.symbol,
      address: t.address,
      firstSeenBlock: blocks[firstIdx]!,
      multiplierAtFirstSeen: grid[firstIdx]![ti]!,
      events: [],
      truncated: true,
    };
  });

const all = [...histories, ...truncatedNoSearch];
const events = all.flatMap((h) => h.events).sort((a, b) => Number(a.effectiveAt - b.effectiveAt));

console.log(`\n${events.length} corporate actions recovered\n`);
console.log(
  `${"SYM".padEnd(8)}${"effective (UTC)".padEnd(22)}${"step".padStart(9)}${"notice".padStart(10)}  multiplier`
);
console.log("-".repeat(84));
for (const e of events) {
  const notice = e.noticeSeconds === null ? "unknown" : `${e.noticeSeconds}s`;
  console.log(
    e.symbol.padEnd(8) +
      new Date(Number(e.effectiveAt) * 1000).toISOString().replace("T", " ").slice(0, 19).padEnd(22) +
      `+${e.stepBps.toFixed(2)}`.padStart(9) +
      notice.padStart(10) +
      `  ${formatUnits(e.fromMultiplier, 18)} -> ${formatUnits(e.toMultiplier, 18)}`
  );
}
console.log("-".repeat(84));

const notices = events.map((e) => e.noticeSeconds).filter((n): n is number => n !== null);
if (notices.length) {
  console.log(
    `\nadvance notice: min ${Math.min(...notices)}s, max ${Math.max(...notices)}s, median ${
      notices.sort((a, b) => a - b)[Math.floor(notices.length / 2)]
    }s  (n=${notices.length})`
  );
  console.log("venus tolerates 3900s of price staleness on these same tokens");
}

const truncated = all.filter((h) => h.truncated);
if (truncated.length) {
  console.log(`\n${truncated.length} token(s) were already off 1.0 when first observed:`);
  console.log(`  ${truncated.map((h) => h.symbol).join(" ")}`);
  console.log("  their earlier history predates the scan window and is reported as unknown");
}

writeFileSync(
  EVENTS_PATH,
  `${JSON.stringify(
    { generatedAt: new Date().toISOString(), headBlock: head, scanStart: START, samples: SAMPLES, histories: all, events },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  )}\n`
);
console.log(`\ntotal ${Date.now() - started}ms. wrote data/events.json`);
