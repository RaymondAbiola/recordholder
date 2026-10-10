// Pulls Binance's own RWA token lists for BSC and cross-checks them against the chain.
//
//   npm run rwa              fetch (needs the VPN and keys), cache to data/rwa-tokens.json, analyse
//   npm run rwa -- --offline analyse the cached file only
//
// Four questions, each answered from data rather than assumed:
//   1. How complete is our catalogue against the issuer's own list?
//   2. Does the issuer's tokenToShareRatio match the on-chain multiplier, and in which direction?
//   3. Is the issuer's token price per token or per share, relative to its reference price?
//   4. Do Ondo's tokens carry the same multiplier mechanism as bStocks?

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { client } from "../src/config";
import { loadCatalogue } from "../src/catalogue";
import { bep677Abi, INTERFACE_IDS } from "../src/abi";
import { ENDPOINTS, call, BinanceConfigError } from "../src/binance";

const CHAIN = process.env.BINANCE_BSC_CHAIN_ID || "56";
const CACHE = process.env.RWA_CACHE_PATH || join(process.cwd(), "data", "rwa-tokens.json");
const offline = process.argv.includes("--offline");

type RwaToken = {
  platformId: string;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  underlyingTicker: string;
  underlyingName: string;
  tokenToShareRatio: string | null;
  tokenPrice: string | null;
  referencePrice: string | null;
  marketStatus: string | null;
  openState: boolean | null;
  nextOpenTime: number | null;
  nextCloseTime: number | null;
};

type Cache = { fetchedAt: string; chain: string; tokens: RwaToken[] };

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

function normalise(raw: Record<string, any>): RwaToken | null {
  const addr = raw.tokenContractAddress;
  if (typeof addr !== "string" || !isAddress(addr)) return null;
  const si = (raw.statusInfo ?? {}) as Record<string, any>;
  return {
    platformId: String(raw.platformId ?? ""),
    address: getAddress(addr),
    symbol: String(raw.tokenSymbol ?? ""),
    name: String(raw.tokenName ?? ""),
    decimals: Number(raw.decimals ?? 18),
    underlyingTicker: String(raw.underlyingTicker ?? ""),
    underlyingName: String(raw.underlyingName ?? ""),
    tokenToShareRatio: str(raw.tokenToShareRatio),
    tokenPrice: str(raw.tokenPrice),
    referencePrice: str(raw.referencePrice),
    marketStatus: str(si.marketStatus),
    openState: typeof si.openState === "boolean" ? si.openState : null,
    nextOpenTime: typeof si.nextOpenTime === "number" ? si.nextOpenTime : null,
    nextCloseTime: typeof si.nextCloseTime === "number" ? si.nextCloseTime : null,
  };
}

async function fetchAll(): Promise<Cache> {
  const tokens: RwaToken[] = [];
  for (const platformId of ["bstock", "ondo"]) {
    process.stdout.write(`fetching ${platformId} on chain ${CHAIN} ... `);
    const res = await call<{ code?: number; msg?: string; data?: Record<string, any>[] }>(
      ENDPOINTS.rwaTokens,
      { binanceChainId: CHAIN, platformId }
    );
    if (!res.ok) {
      console.log(`failed: ${res.error}`);
      if (res.body) console.log(`  ${res.body}`);
      process.exit(1);
    }
    if (res.data.code !== 0 || !Array.isArray(res.data.data)) {
      console.log(`unexpected shape: ${JSON.stringify(res.data).slice(0, 400)}`);
      process.exit(1);
    }
    const parsed = res.data.data.map(normalise).filter((t): t is RwaToken => t !== null);
    console.log(`${parsed.length} tokens in ${res.elapsedMs}ms`);
    tokens.push(...parsed);
  }
  return { fetchedAt: new Date().toISOString(), chain: CHAIN, tokens };
}

let cache: Cache;
if (offline) {
  if (!existsSync(CACHE)) {
    console.error("no data/rwa-tokens.json. run `npm run rwa` once with the VPN on.");
    process.exit(1);
  }
  cache = JSON.parse(readFileSync(CACHE, "utf8")) as Cache;
  console.log(`using cache from ${cache.fetchedAt}`);
} else {
  try {
    cache = await fetchAll();
  } catch (e) {
    if (e instanceof BinanceConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(`wrote data/rwa-tokens.json (${cache.tokens.length} tokens)\n`);
}

const bstock = cache.tokens.filter((t) => t.platformId === "bstock");
const ondo = cache.tokens.filter((t) => t.platformId === "ondo");

// ---------------------------------------------------------------------------
console.log("1. coverage of our catalogue against the issuer's own list");
console.log("-".repeat(72));
const ours = new Map(loadCatalogue().tokens.map((t) => [t.address.toLowerCase(), t]));
const theirs = new Map(bstock.map((t) => [t.address.toLowerCase(), t]));
const missing = bstock.filter((t) => !ours.has(t.address.toLowerCase()));
const extra = [...ours.values()].filter((t) => !theirs.has(t.address.toLowerCase()));
console.log(`  binance lists ${bstock.length} bStocks, our catalogue has ${ours.size}`);
console.log(`  in binance's list but not ours: ${missing.length}`);
for (const t of missing) console.log(`    ${t.symbol.padEnd(8)} ${t.underlyingName.padEnd(34)} ${t.address}`);
console.log(`  in ours but not binance's:      ${extra.length}${extra.length ? `  (${extra.map((t) => t.symbol).join(" ")})` : ""}`);

// ---------------------------------------------------------------------------
type Multi = Map<string, bigint | null>;

async function readMultipliers(addrs: readonly Address[]): Promise<Multi> {
  const out: Multi = new Map();
  for (let i = 0; i < addrs.length; i += 40) {
    const batch = addrs.slice(i, i + 40);
    const res = await client.multicall({
      contracts: batch.map((address) => ({ address, abi: bep677Abi, functionName: "uiMultiplier" as const })),
    });
    batch.forEach((a, j) => {
      const r = res[j];
      out.set(a.toLowerCase(), r?.status === "success" ? (r.result as bigint) : null);
    });
  }
  return out;
}

console.log("\n2. does tokenToShareRatio match the on-chain multiplier, and which way round");
console.log("-".repeat(72));
const mult = await readMultipliers(bstock.map((t) => t.address));
let direct = 0, inverse = 0, neither = 0, flat = 0, noRatio = 0;
const rows: string[] = [];
for (const t of bstock) {
  const m = mult.get(t.address.toLowerCase());
  const ratio = t.tokenToShareRatio === null ? NaN : Number(t.tokenToShareRatio);
  if (m === null || m === undefined || Number.isNaN(ratio)) { noRatio++; continue; }
  const mNum = Number(m) / 1e18;
  if (Math.abs(mNum - 1) < 1e-12) { flat++; continue; }
  const close = (a: number, b: number) => Math.abs(a - b) / Math.abs(b) < 1e-6;
  const verdict = close(ratio, mNum) ? "= multiplier" : close(ratio, 1 / mNum) ? "= 1/multiplier" : "neither";
  if (verdict === "= multiplier") direct++; else if (verdict === "= 1/multiplier") inverse++; else neither++;
  rows.push(`    ${t.symbol.padEnd(8)} on-chain ${mNum.toFixed(9)}   binance ratio ${ratio.toFixed(9)}   ${verdict}`);
}
rows.slice(0, 12).forEach((r) => console.log(r));
if (rows.length > 12) console.log(`    ... ${rows.length - 12} more`);
console.log(`  divergent tokens: equals multiplier ${direct}, equals 1/multiplier ${inverse}, neither ${neither}`);
console.log(`  tokens at exactly 1.0 (uninformative): ${flat}, unreadable: ${noRatio}`);
if (direct > 0 && inverse === 0 && neither === 0) {
  console.log("  FINDING: binance publishes the multiplier itself, as tokenToShareRatio, for these tokens.");
  console.log("  That is the ratio, not a balance. What its balances endpoint reports is a separate");
  console.log("  question, answered by `npm run binance:balances`.");
} else if (neither > 0 || (direct > 0 && inverse > 0)) {
  console.log("  MIXED: record the rows above verbatim, do not summarise.");
}

// ---------------------------------------------------------------------------
console.log("\n3. token price against reference price, divergent tokens only");
console.log("-".repeat(72));
console.log("  (weekend: reference is a last close, token trades 24/7, so a gap is expected)");
let identity = 0, compared = 0;
for (const t of bstock) {
  const ratio = Number(t.tokenToShareRatio), tp = Number(t.tokenPrice), rp = Number(t.referencePrice);
  const m = mult.get(t.address.toLowerCase());
  if (!m || m === 10n ** 18n || !ratio || !tp || !rp) continue;
  compared++;
  if (Math.abs(tp - rp * ratio) / tp < 1e-9) identity++;
}
console.log(`  tokenPrice == referencePrice x tokenToShareRatio for ${identity} of ${compared} divergent tokens`);
console.log("  (if so, tokenPrice is derived from the share price and the multiplier, not a market quote)");
let shown = 0;
for (const t of bstock) {
  const m = mult.get(t.address.toLowerCase());
  if (m === null || m === undefined || m === 10n ** 18n) continue;
  const tp = Number(t.tokenPrice), rp = Number(t.referencePrice);
  if (!tp || !rp) continue;
  const mNum = Number(m) / 1e18;
  console.log(
    `    ${t.symbol.padEnd(8)} token ${tp.toFixed(4).padStart(10)}  ref ${rp.toFixed(4).padStart(10)}  token/ref ${(tp / rp).toFixed(6)}  multiplier ${mNum.toFixed(6)}`
  );
  if (++shown >= 8) break;
}

// ---------------------------------------------------------------------------
console.log("\n4. do ondo tokens carry a scaled-ui multiplier");
console.log("-".repeat(72));

const sharesAbi = [
  { type: "function", name: "sharesMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

let ercCore = 0, ercScheduled = 0, hasShares = 0, readable = 0;
const sample: string[] = [];
for (let i = 0; i < ondo.length; i += 40) {
  const batch = ondo.slice(i, i + 40);
  const res = await client.multicall({
    contracts: batch.flatMap((t) => [
      { address: t.address, abi: bep677Abi, functionName: "supportsInterface" as const, args: [INTERFACE_IDS.IScaledUIAmount] as const },
      { address: t.address, abi: bep677Abi, functionName: "supportsInterface" as const, args: [INTERFACE_IDS.IERC8056Scheduled] as const },
      { address: t.address, abi: sharesAbi, functionName: "sharesMultiplier" as const },
    ]),
  });
  batch.forEach((t, j) => {
    const [core, sched, shares] = res.slice(j * 3, j * 3 + 3);
    const isCore = core?.status === "success" && core.result === true;
    const isSched = sched?.status === "success" && sched.result === true;
    const isShares = shares?.status === "success";
    if (core?.status === "success" || shares?.status === "success") readable++;
    if (isCore) ercCore++;
    if (isSched) ercScheduled++;
    if (isShares) { hasShares++; if (sample.length < 3) sample.push(`${t.symbol} sharesMultiplier=${String(shares!.result)}`); }
  });
}
console.log(`  ondo tokens checked: ${ondo.length}  (answered at least one probe: ${readable})`);
console.log(`  implement IScaledUIAmount (ERC-8056 core):   ${ercCore}`);
console.log(`  implement IERC8056Scheduled (BSC extension): ${ercScheduled}`);
console.log(`  expose sharesMultiplier() instead:           ${hasShares}${sample.length ? `   e.g. ${sample.join(", ")}` : ""}`);

// ---------------------------------------------------------------------------
console.log("\n5. market status as reported by binance (for the market-hours section of the report)");
console.log("-".repeat(72));
const byStatus = new Map<string, number>();
for (const t of cache.tokens) byStatus.set(`${t.platformId}:${t.marketStatus ?? "unknown"}`, (byStatus.get(`${t.platformId}:${t.marketStatus ?? "unknown"}`) ?? 0) + 1);
for (const [k, v] of [...byStatus.entries()].sort()) console.log(`  ${k.padEnd(22)} ${v}`);
const sampleTok = bstock.find((t) => t.nextOpenTime);
if (sampleTok) {
  console.log(
    `  e.g. ${sampleTok.symbol}: openState=${sampleTok.openState}, next open ${new Date(sampleTok.nextOpenTime! * (sampleTok.nextOpenTime! < 1e12 ? 1000 : 1)).toISOString()}`
  );
}
