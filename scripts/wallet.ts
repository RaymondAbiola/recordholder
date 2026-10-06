import { formatUnits, isAddress, type Address } from "viem";
import { client, archiveClient } from "../src/config";
import { loadEvents } from "../src/snapshot";
import { walletReport } from "../src/wallet";

const account = process.argv[2];
if (!account || !isAddress(account)) {
  console.error("usage: npm run wallet -- <address>");
  process.exit(1);
}

const snapshot = loadEvents();
if (!snapshot) {
  console.error("no data/events.json. run `npm run events` first.");
  process.exit(1);
}

const started = Date.now();
const r = await walletReport(client, archiveClient, account as Address, snapshot.events);

const n = (v: bigint, places = 4) =>
  Number(formatUnits(v, 18)).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });

// Credits can be genuinely tiny. Printing 0.0000 for a nonzero amount would be a lie,
// so fall through to a floor marker rather than rounding it away.
const shares = (v: bigint, places = 6) => {
  if (v === 0n) return (0).toFixed(places);
  const asNumber = Number(formatUnits(v, 18));
  const floor = 10 ** -places;
  return asNumber < floor ? `<${floor.toFixed(places)}` : n(v, places);
};

console.log(`${r.account}\n`);

if (r.positions.length === 0) {
  console.log("holds no bStocks today");
} else {
  console.log(`holdings (${r.positions.length})`);
  console.log(`${"SYM".padEnd(8)}${"balanceOf".padStart(18)}${"true shares".padStart(18)}${"hidden".padStart(14)}`);
  console.log("-".repeat(58));
  for (const p of r.positions) {
    console.log(
      p.token.symbol.padEnd(8) +
        n(p.raw, 2).padStart(18) +
        n(p.shares, 2).padStart(18) +
        n(p.hidden).padStart(14)
    );
  }
  console.log("-".repeat(58));
  console.log(`${"".padEnd(8)}${"hidden right now".padStart(36)}${n(r.hiddenNow).padStart(14)}`);
}

console.log(`\ncorporate actions held through (${r.held.length} of ${snapshot.events.length})`);
if (r.held.length === 0) {
  console.log("  none. this account held no bStock at the moment any multiplier moved.");
} else {
  console.log(
    `${"SYM".padEnd(8)}${"date".padEnd(13)}${"held then".padStart(16)}${"shares paid".padStart(15)}  status`
  );
  console.log("-".repeat(70));
  for (const h of r.held) {
    console.log(
      h.event.symbol.padEnd(8) +
        new Date(Number(h.event.effectiveAt) * 1000).toISOString().slice(0, 10).padEnd(13) +
        n(h.rawAtEvent).padStart(16) +
        shares(h.sharesGained).padStart(15) +
        "  " +
        (h.stillHeld ? "still held" : "since closed")
    );
  }
  console.log("-".repeat(70));
  console.log(`${"".padEnd(37)}${"total".padStart(0)}${shares(r.sharesGainedTotal).padStart(15)}`);
  console.log("\nnone of the above moved a raw balance, so no wallet, explorer or");
  console.log("portfolio tracker reading balanceOf reported any of it.");
}

console.log(`\n${Date.now() - started}ms`);
