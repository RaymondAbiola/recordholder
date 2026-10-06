// Does Binance's own developer API report BEP-677 balances raw, or multiplier-adjusted?
//
// Both answers are findings. Raw means the issuer's own developer surface shows the
// un-multiplied figure for the issuer's own tokenized stock product. Adjusted means the
// correct number exists at source and simply does not propagate to anything else.
//
// The comparison is run across every divergent token the address holds, so one token
// landing ambiguously does not decide it.

import { formatUnits, isAddress, getAddress, type Address } from "viem";
import { client } from "../src/config";
import { loadSweep } from "../src/snapshot";
import { readPositions } from "../src/wallet";
import {
  buildSignedRequest,
  call,
  describeCredentials,
  verifySigning,
  baseUrl,
  ENDPOINTS,
  BinanceConfigError,
} from "../src/binance";

// Confirm against the developer portal before the first live run; override with
// BINANCE_BALANCE_PATH rather than editing this.
const BALANCE_PATH = process.env.BINANCE_BALANCE_PATH || ENDPOINTS.tokenBalances;
const CHAIN_ID = process.env.BINANCE_BSC_CHAIN_ID || "56";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const account = args.find((a) => isAddress(a));

console.log("signing self-check");
console.log(`  hmac-sha256 vector  ${verifySigning().hmac ? "ok" : "FAILED"}`);
console.log(`  credentials         ${describeCredentials()}`);
console.log(`  base url            ${baseUrl()}`);
console.log(`  endpoint            ${BALANCE_PATH}`);

if (!verifySigning().hmac) process.exit(1);

if (dryRun) {
  try {
    const req = buildSignedRequest(BALANCE_PATH, {
      binanceChainId: CHAIN_ID,
      address: account ?? "0x0000000000000000000000000000000000000000",
    });
    const redacted = req.url;
    console.log("\ndry run, nothing sent");
    console.log(`  method    ${req.method}`);
    console.log(`  url       ${redacted}`);
    console.log("  headers   X-OC-APIKEY <redacted>, X-OC-TIMESTAMP, X-OC-SIGN <redacted>,");
    console.log("            X-OC-RECV-WINDOW 15000, X-OC-NONCE");
    console.log(`  signed    ${req.preHash}`);
  } catch (e) {
    console.log(`\ndry run: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(0);
}

if (!account) {
  console.error("\nusage: npm run binance:balances -- <address> [--dry-run]");
  process.exit(1);
}

const sweep = loadSweep();
if (!sweep) {
  console.error("no data/sweep.json. run `npm run sweep` first.");
  process.exit(1);
}

const addr = getAddress(account) as Address;
const divergentTokens = sweep.divergent.map((r) => r.address);

console.log(`\nchain side, ${addr}`);
const positions = (await readPositions(client, addr)).filter((p) =>
  divergentTokens.includes(p.token.address)
);
if (positions.length === 0) {
  console.error("  holds none of the divergent tokens, so there is nothing to compare");
  process.exit(1);
}
console.log(`  ${positions.length} divergent holdings read from chain`);

console.log("\nbinance side");
let res;
try {
  res = await call<unknown>(BALANCE_PATH, { binanceChainId: CHAIN_ID, address: addr });
} catch (e) {
  if (e instanceof BinanceConfigError) {
    console.error(`  ${e.message}`);
    process.exit(1);
  }
  throw e;
}

console.log(`  ${res.elapsedMs}ms`);
if (!res.ok) {
  console.error(`  failed: ${res.error}`);
  if (res.body) console.error(`  body: ${res.body}`);
  console.error("\nIf this is a 404 the endpoint path is wrong; set BINANCE_BALANCE_PATH.");
  console.error("If it is an auth error, check the key is enabled for the Web3 API.");
  process.exit(1);
}

// Shape is unknown until the first live response. Walk the JSON for anything that
// pairs a contract address with an amount, and dump it if nothing matches.
type Found = { address: string; amount: string };
const found: Found[] = [];
const walk = (node: unknown): void => {
  if (Array.isArray(node)) return node.forEach(walk);
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const addrKey = ["contractAddress", "tokenAddress", "address", "contract"].find(
      (k) => typeof o[k] === "string" && isAddress(o[k] as string)
    );
    const amtKey = ["balance", "amount", "rawBalance", "quantity", "value"].find(
      (k) => typeof o[k] === "string" || typeof o[k] === "number"
    );
    if (addrKey && amtKey) found.push({ address: o[addrKey] as string, amount: String(o[amtKey]) });
    Object.values(o).forEach(walk);
  }
};
walk(res.data);

if (found.length === 0) {
  console.log("  could not locate balances in the response. raw shape follows:\n");
  console.log(JSON.stringify(res.data, null, 2).slice(0, 2500));
  process.exit(0);
}

console.log(`  ${found.length} balance entries returned\n`);

const byAddress = new Map(found.map((f) => [f.address.toLowerCase(), f.amount]));
let rawMatches = 0;
let uiMatches = 0;
let neither = 0;

console.log(
  `${"SYM".padEnd(8)}${"binance reports".padStart(20)}${"raw".padStart(20)}${"ui-adjusted".padStart(20)}  verdict`
);
console.log("-".repeat(90));

for (const p of positions) {
  const reported = byAddress.get(p.token.address.toLowerCase());
  if (reported === undefined) continue;

  // tolerate decimal strings as well as integer wei
  const asWei = reported.includes(".")
    ? BigInt(Math.round(Number(reported) * 10 ** p.token.decimals))
    : BigInt(reported);

  const near = (a: bigint, b: bigint) => {
    const d = a > b ? a - b : b - a;
    return b === 0n ? d === 0n : (d * 1_000_000n) / (b < 0n ? -b : b) < 100n; // within 0.01%
  };

  let verdict: string;
  if (near(asWei, p.raw) && !near(asWei, p.shares)) {
    verdict = "RAW";
    rawMatches++;
  } else if (near(asWei, p.shares) && !near(asWei, p.raw)) {
    verdict = "ui-adjusted";
    uiMatches++;
  } else if (near(asWei, p.raw) && near(asWei, p.shares)) {
    verdict = "indistinguishable";
  } else {
    verdict = "neither";
    neither++;
  }

  console.log(
    p.token.symbol.padEnd(8) +
      formatUnits(asWei, p.token.decimals).slice(0, 18).padStart(20) +
      formatUnits(p.raw, p.token.decimals).slice(0, 18).padStart(20) +
      formatUnits(p.shares, p.token.decimals).slice(0, 18).padStart(20) +
      "  " +
      verdict
  );
}

console.log("-".repeat(90));
console.log(`\nraw: ${rawMatches}   ui-adjusted: ${uiMatches}   neither: ${neither}`);

if (rawMatches > 0 && uiMatches === 0) {
  console.log(
    "\nFINDING: the API reports raw balances. Binance's own developer surface shows the\n" +
      "un-multiplied figure for Binance's own tokenized stock product, so a consumer\n" +
      "building against it inherits the same blind spot as reading balanceOf directly."
  );
} else if (uiMatches > 0 && rawMatches === 0) {
  console.log(
    "\nFINDING: the API reports multiplier-adjusted balances. The correct share count\n" +
      "exists at source, which means the failure is one of propagation: it is available\n" +
      "here and absent from everything downstream."
  );
} else {
  console.log("\nMixed or inconclusive. Record the table above verbatim in the log.");
}
