// Rebuilds data/tokens.json.
//
// There is no on-chain registry: every bStock is a beacon proxy sharing one beacon,
// but the beacon's owner is an EOA, so nothing enumerates them. CoinGecko's coins/list
// is the only working discovery source found. Everything it returns is then verified
// on-chain and anything that fails verification is dropped.

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { client } from "../src/config";
import { bep677Abi, INTERFACE_IDS } from "../src/abi";
import { CATALOGUE_PATH, type Catalogue, type CatalogueToken } from "../src/catalogue";

const COINGECKO = "https://api.coingecko.com/api/v3/coins/list?include_platform=true";
const PLATFORMS = ["binance-smart-chain", "bnb-smart-chain"] as const;
const CHUNK = 40;

type CoinRow = { symbol: string; name: string; platforms?: Record<string, string | null> };

const chunk = <T,>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

console.log("fetching discovery list from coingecko");
const res = await fetch(COINGECKO);
if (!res.ok) {
  console.error(`coingecko returned ${res.status}`);
  process.exit(1);
}
const all = (await res.json()) as CoinRow[];

const candidates = all
  .filter((c) => /bstocks/i.test(c.name))
  .map((c) => {
    const addr = PLATFORMS.map((p) => c.platforms?.[p]).find((a) => a && isAddress(a));
    return addr ? { symbol: c.symbol.toUpperCase(), cgName: c.name, address: getAddress(addr) } : null;
  })
  .filter((c): c is { symbol: string; cgName: string; address: Address } => c !== null);

console.log(`  ${candidates.length} candidates with a BSC address`);

console.log("verifying on-chain (erc-165 + name/symbol/decimals)");
const verified: CatalogueToken[] = [];
const rejected: { symbol: string; reason: string }[] = [];

for (const batch of chunk(candidates, CHUNK)) {
  const reads = await client.multicall({
    contracts: batch.flatMap((c) => [
      { address: c.address, abi: bep677Abi, functionName: "supportsInterface", args: [INTERFACE_IDS.IScaledUIAmount] },
      { address: c.address, abi: bep677Abi, functionName: "name" },
      { address: c.address, abi: bep677Abi, functionName: "symbol" },
      { address: c.address, abi: bep677Abi, functionName: "decimals" },
    ] as const),
  });

  batch.forEach((c, i) => {
    const [is8056, name, symbol, decimals] = reads.slice(i * 4, i * 4 + 4);
    if (is8056?.status !== "success" || is8056.result !== true) {
      rejected.push({ symbol: c.symbol, reason: "does not report IScaledUIAmount" });
      return;
    }
    if (name?.status !== "success" || symbol?.status !== "success" || decimals?.status !== "success") {
      rejected.push({ symbol: c.symbol, reason: "metadata read failed" });
      return;
    }
    verified.push({
      issuer: "bstocks",
      symbol: symbol.result as string,
      name: (name.result as string).trim(),
      underlying: c.cgName.replace(/\s*\(bStocks Tokenized Stock\)\s*$/i, "").trim(),
      address: c.address,
      decimals: Number(decimals.result),
    });
  });
  process.stdout.write(`  verified ${verified.length}/${candidates.length}\r`);
}
console.log(`  verified ${verified.length}/${candidates.length}    `);

for (const r of rejected) console.log(`  dropped ${r.symbol}: ${r.reason}`);

verified.sort((a, b) => a.symbol.localeCompare(b.symbol));

const previous: Catalogue | null = existsSync(CATALOGUE_PATH)
  ? (JSON.parse(readFileSync(CATALOGUE_PATH, "utf8")) as Catalogue)
  : null;

if (previous) {
  const before = new Set(previous.tokens.map((t) => t.symbol));
  const after = new Set(verified.map((t) => t.symbol));
  const added = [...after].filter((s) => !before.has(s));
  const removed = [...before].filter((s) => !after.has(s));
  console.log(`\ndrift against existing snapshot: +${added.length} -${removed.length}`);
  if (added.length) console.log(`  added   ${added.join(" ")}`);
  if (removed.length) console.log(`  removed ${removed.join(" ")}`);
}

const catalogue: Catalogue = {
  generatedAt: new Date().toISOString(),
  chainId: 56,
  source: "coingecko coins/list, filtered on bStocks, verified on-chain via ERC-165",
  tokens: verified,
};

mkdirSync(dirname(CATALOGUE_PATH), { recursive: true });
writeFileSync(CATALOGUE_PATH, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`\nwrote ${verified.length} tokens to data/tokens.json`);
