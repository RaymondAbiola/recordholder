import { writeFileSync } from "node:fs";
import { formatUnits } from "viem";
import { client } from "../src/config.js";
import { sweep } from "../src/sweep.js";
import { SWEEP_PATH } from "../src/snapshot.js";

const s = await sweep(client);

const n = (v: bigint, d: number, places = 4) =>
  Number(formatUnits(v, d)).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });

console.log(`block ${s.blockNumber}  ${new Date(Number(s.timestamp) * 1000).toISOString()}`);
console.log(`${s.rows.length} tokens swept in ${s.elapsedMs}ms across ${s.rpcCalls} rpc calls\n`);

console.log("tokens whose multiplier has already moved off 1.0");
console.log(
  `${"SYM".padEnd(8)}${"bps".padStart(8)}  ${"raw supply".padStart(18)}${"true shares".padStart(18)}${"hidden".padStart(14)}  underlying`
);
console.log("-".repeat(104));
for (const r of s.divergent) {
  console.log(
    r.symbol.padEnd(8) +
      (r.deviationBps >= 0 ? "+" : "") +
      r.deviationBps.toFixed(2).padStart(7) +
      "  " +
      n(r.totalSupply, r.decimals, 2).padStart(18) +
      n(r.totalSupplyUI, r.decimals, 2).padStart(18) +
      n(r.hiddenSupply, r.decimals).padStart(14) +
      "  " +
      r.underlying
  );
}
console.log("-".repeat(104));

console.log(`\n${s.divergent.length} of ${s.rows.length} tokens divergent`);
console.log(`hidden share count: ${n(s.hiddenShareCount, 18, 3)}`);
console.log("  (a count across tokens, not a value: one hidden NVDA share and one");
console.log("   hidden Nokia share are both one share. pricing is separate.)");

if (s.pending.length) {
  console.log(`\n${s.pending.length} token(s) with a SCHEDULED change:`);
  for (const r of s.pending) {
    const secs = Number(r.pending!.effectiveAt - s.timestamp);
    console.log(
      `  ${r.symbol}  -> ${formatUnits(r.pending!.multiplier, 18)}  in ${secs}s  (${new Date(
        Number(r.pending!.effectiveAt) * 1000
      ).toISOString()})`
    );
  }
} else {
  console.log("\nno scheduled changes pending across the catalogue");
}

writeFileSync(
  SWEEP_PATH,
  `${JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`
);
console.log(`\nwrote data/sweep.json`);
