// Does Binance's own developer API report BEP-677 balances raw, or multiplier-adjusted?
//
// The balances response carries two fields per token, `balance` and `rawBalance`, so the
// question is really what each of them contains. Each is compared against the chain, for
// every divergent token the address holds, so one ambiguous row cannot decide the result.
//
//   npm run binance:balances -- <address>
//   npm run binance:balances -- <address> --dry-run     builds the request, sends nothing

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, isAddress, getAddress, type Address } from "viem";
import { client } from "../src/config";
import { loadSweep } from "../src/snapshot";
import { readPositions } from "../src/wallet";
import { buildSignedRequest, call, describeCredentials, verifySigning, baseUrl, ENDPOINTS } from "../src/binance";

const CHAIN_ID = process.env.BINANCE_BSC_CHAIN_ID || "56";
const PAGE_SIZE = 100;
const MAX_PAGES = 60;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const account = args.find((a) => isAddress(a));

const checks = verifySigning();
console.log("signing self-check");
console.log(`  hmac vector ${checks.hmac ? "ok" : "FAILED"}, pre-hash ${checks.preHash ? "ok" : "FAILED"}`);
console.log(`  credentials ${describeCredentials()}`);
console.log(`  base url    ${baseUrl()}`);
console.log(`  endpoint    ${ENDPOINTS.allTokenBalances}  (chains=${CHAIN_ID}, pageSize=${PAGE_SIZE})`);
if (!checks.hmac || !checks.preHash) process.exit(1);

const query = (addr: string, page: number) => ({ address: addr, chains: CHAIN_ID, page, pageSize: PAGE_SIZE });

if (dryRun) {
  try {
    const req = buildSignedRequest(ENDPOINTS.allTokenBalances, query(account ?? "0x" + "0".repeat(40), 1));
    console.log("\ndry run, nothing sent");
    console.log(`  ${req.method} ${req.url}`);
    console.log(`  signed string: ${req.preHash}`);
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
const divergent = new Set(sweep.divergent.map((r) => r.address.toLowerCase()));

console.log(`\nchain side, ${addr}`);
const positions = (await readPositions(client, addr)).filter(
  // sub-token balances are rounded away by a display field, so they cannot tell the two apart
  (p) => divergent.has(p.token.address.toLowerCase()) && p.raw >= 10n ** BigInt(p.token.decimals)
);
if (positions.length === 0) {
  console.error("  holds no divergent token with a balance of at least 1, nothing to compare");
  process.exit(1);
}
console.log(`  ${positions.length} comparable holdings read from chain`);

type Asset = {
  tokenContractAddress?: string;
  symbol?: string;
  balance?: string;
  rawBalance?: string;
  tokenPrice?: string;
  isRiskToken?: boolean;
};

console.log("\nbinance side");
const assets: Asset[] = [];
const needed = new Set(positions.map((p) => p.token.address.toLowerCase()));
const seen = new Set<string>();
let totalMs = 0;
let pagesFetched = 0;
let capped = false;
for (let page = 1; page <= MAX_PAGES; page++) {
  const res = await call<{ code?: number | string; msg?: string; data?: { tokenAssets?: Asset[] }[] }>(
    ENDPOINTS.allTokenBalances,
    query(addr, page)
  );
  totalMs += res.elapsedMs;
  if (!res.ok) {
    console.error(`  page ${page} failed: ${res.error}`);
    if (res.body) console.error(`  body: ${res.body}`);
    process.exit(1);
  }
  const got = (res.data.data ?? []).flatMap((d) => d.tokenAssets ?? []);
  if (page === 1 && got.length === 0) {
    console.log("  no tokenAssets in the response. raw shape follows:\n");
    console.log(JSON.stringify(res.data, null, 2).slice(0, 2500));
    process.exit(0);
  }
  assets.push(...got);
  pagesFetched = page;
  for (const a of got) if (a.tokenContractAddress) seen.add(a.tokenContractAddress.toLowerCase());
  if ([...needed].every((a) => seen.has(a))) break;
  if (got.length < PAGE_SIZE) break;
  if (page === MAX_PAGES) capped = true;
}
console.log(`  ${assets.length} tokens returned in ${totalMs}ms across ${pagesFetched} page(s)`);
if (capped) console.log(`  WARNING: stopped at the ${MAX_PAGES}-page cap, so a "not returned" count below may be an artefact`);

const byAddress = new Map(
  assets.filter((a) => a.tokenContractAddress).map((a) => [a.tokenContractAddress!.toLowerCase(), a])
);

// A field may be a decimal string ("2329.2025") or an integer in smallest units.
const toNumber = (v: string | undefined, decimals: number): number | null => {
  if (v === undefined || v === "") return null;
  if (/^\d+$/.test(v) && v.length > decimals - 4) return Number(formatUnits(BigInt(v), decimals));
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const REL = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) <= REL * Math.max(Math.abs(b), 1e-18);
const classify = (reported: number | null, raw: number, shares: number) => {
  if (reported === null) return "missing";
  const isRaw = near(reported, raw);
  const isUi = near(reported, shares);
  if (isRaw && isUi) return "either";
  return isRaw ? "RAW" : isUi ? "UI-adjusted" : "neither";
};

// The same rows carry a tokenPrice. Whether it is per token (reference x multiplier) or per
// share (reference) decides whether value = balance x tokenPrice is right even though the
// share count is not.
type Listed = { address: string; referencePrice: string | null };
const refPrice = new Map<string, number>();
try {
  const cached = JSON.parse(readFileSync(join(process.cwd(), "data", "rwa-tokens.json"), "utf8")) as {
    tokens: Listed[];
  };
  for (const t of cached.tokens) if (t.referencePrice) refPrice.set(t.address.toLowerCase(), Number(t.referencePrice));
} catch {
  // no cache: the price column is simply omitted
}
const priceTally = new Map<string, number>();
const priceRows: string[] = [];
const captured: Record<string, unknown>[] = [];

const tally = { balance: new Map<string, number>(), rawBalance: new Map<string, number>() };
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

console.log(
  `\n${"SYM".padEnd(8)}${"chain raw".padStart(16)}${"chain shares".padStart(16)}${"api balance".padStart(16)}${"api rawBalance".padStart(16)}  balance / rawBalance`
);
console.log("-".repeat(98));
let missing = 0;
for (const p of positions) {
  const a = byAddress.get(p.token.address.toLowerCase());
  if (!a) { missing++; continue; }
  const raw = Number(formatUnits(p.raw, p.token.decimals));
  const shares = Number(formatUnits(p.shares, p.token.decimals));
  const b = toNumber(a.balance, p.token.decimals);
  const rb = toNumber(a.rawBalance, p.token.decimals);
  captured.push({
    symbol: p.token.symbol,
    underlying: p.token.underlying,
    address: p.token.address,
    chainRaw: raw.toFixed(6),
    chainShares: shares.toFixed(6),
    apiBalance: a.balance ?? null,
    apiRawBalance: a.rawBalance ?? null,
    apiTokenPrice: a.tokenPrice ?? null,
  });
  const cb = classify(b, raw, shares);
  const crb = classify(rb, raw, shares);
  bump(tally.balance, cb);
  bump(tally.rawBalance, crb);
  const f = (n: number | null) => (n === null ? "-" : n.toFixed(6));
  const apiPrice = a.tokenPrice ? Number(a.tokenPrice) : NaN;
  const ref = refPrice.get(p.token.address.toLowerCase());
  const mult = shares / raw;
  if (ref && Number.isFinite(apiPrice)) {
    const ratio = apiPrice / ref;
    const verdict = Math.abs(ratio - mult) < 1e-5 ? "per token" : Math.abs(ratio - 1) < 1e-6 ? "per share" : "neither";
    priceTally.set(verdict, (priceTally.get(verdict) ?? 0) + 1);
    priceRows.push(
      `  ${p.token.symbol.padEnd(8)} api price ${apiPrice.toFixed(4).padStart(10)}  reference ${ref.toFixed(4).padStart(10)}  price/ref ${ratio.toFixed(6)}  multiplier ${mult.toFixed(6)}  off per-token by ${(((ratio - mult) / mult) * 1e6).toFixed(0)} ppm  ${verdict}`
    );
  }
  console.log(
    p.token.symbol.padEnd(8) + f(raw).padStart(16) + f(shares).padStart(16) + f(b).padStart(16) + f(rb).padStart(16) + `  ${cb} / ${crb}`
  );
}
console.log("-".repeat(98));
if (missing) console.log(`${missing} held token(s) were not returned by the API at all`);

if (priceTally.size) {
  console.log(`\nprice carried in the same rows, against the issuer's per-share reference price:`);
  console.log(`  ${[...priceTally.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  priceRows.forEach((r) => console.log(r));
  console.log("  per token = reference x multiplier, so balance x price is the correct value");
  console.log("  per share = reference, so balance x price understates value by the multiplier");
}

const show = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => `${k} ${v}`).join(", ") || "none";
console.log(`\nbalance:    ${show(tally.balance)}`);
console.log(`rawBalance: ${show(tally.rawBalance)}`);
writeFileSync(
  join(process.cwd(), "data", "binance-balances.json"),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString().slice(0, 10),
      source: "npm run binance:balances",
      account: addr,
      accountLabel: addr.toLowerCase() === "0x8f73b65b4caaf64fba2af91cc5d4a2a1318e5d8c" ? "Lista Moolah" : "",
      endpoint: ENDPOINTS.allTokenBalances,
      chain: CHAIN_ID,
      tokensReturned: assets.length,
      pages: pagesFetched,
      elapsedMs: totalMs,
      rows: captured,
    },
    null,
    2
  )}\n`
);
console.log("\nwrote data/binance-balances.json");

console.log("\nRecord the table above verbatim in docs/devex-log.md. Either outcome is a finding:");
console.log("  RAW          the API's own balance shows the un-multiplied figure for the issuer's own product");
console.log("  UI-adjusted  the correct share count is available at source, so the gap is one of propagation");
console.log("  either       the two cannot be told apart for that row, so it carries no weight");
