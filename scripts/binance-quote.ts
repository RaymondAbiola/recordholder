// Measures liquidity and slippage on Binance's aggregator by asking for quotes only.
//
// A quote is a price request. It carries a quoteId that expires in about 30 seconds and that
// only the swap endpoint consumes, so nothing here spends funds, signs anything or moves
// anything. For each token and order size it records every route returned, so the result
// shows how the executable price degrades as size grows and which venues quote at all.
//
//   npm run binance:quote
//   npm run binance:quote -- NVDAB SPYB NOKB

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, parseUnits } from "viem";
import { call, ENDPOINTS, describeCredentials, verifySigning } from "../src/binance";
import { loadCatalogue } from "../src/catalogue";

const CHAIN = process.env.BINANCE_BSC_CHAIN_ID || "56";
// BSC-USD (Binance-Peg USDT). 18 decimals on BSC, unlike the 6 on most other chains.
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDT_DECIMALS = 18;
// RFQ routes need a receiver address. It must match the wallet that later signs the swap,
// and no swap is ever built here, so a neutral address is enough to get a price.
const RECEIVER = process.env.QUOTE_RECEIVER || "0x000000000000000000000000000000000000dEaD";
const SIZES_USD = [10, 100, 1_000, 10_000, 100_000];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const symbols = wanted.length ? wanted.map((s) => s.toUpperCase()) : ["NVDAB", "SPYB", "NOKB"];

const checks = verifySigning();
console.log(`signing self-check: hmac ${checks.hmac ? "ok" : "FAILED"}, pre-hash ${checks.preHash ? "ok" : "FAILED"}`);
console.log(`credentials: ${describeCredentials()}`);
if (!checks.hmac || !checks.preHash) process.exit(1);

// the reference price per token, from the token list captured earlier, so the executable
// price can be compared with what Binance itself says one token is worth
const rwa = JSON.parse(readFileSync(join(process.cwd(), "data", "rwa-tokens.json"), "utf8")) as {
  tokens: { address: string; symbol: string; tokenPrice: string | null; referencePrice: string | null }[];
};
const refByAddr = new Map(rwa.tokens.map((t) => [t.address.toLowerCase(), t]));
const catalogue = loadCatalogue().tokens;

type Route = {
  quoteId?: string;
  vendorName?: string;
  executionMode?: string;
  isBest?: boolean;
  fromTokenAmount?: string;
  toTokenAmount?: string;
  priceImpactPercent?: string;
  tradeFee?: string;
  estimateGasFee?: string;
  toToken?: { token_unit_price?: string; tokenUnitPrice?: string; decimal?: string };
};

type Row = {
  symbol: string;
  sizeUsd: number;
  ms: number;
  ok: boolean;
  error?: string;
  routes: {
    vendor: string;
    mode: string;
    best: boolean;
    tokensOut: number | null;
    effectivePrice: number | null;
    vsReferenceBps: number | null;
    reportedImpactPct: string | null;
    gasUsd: string | null;
  }[];
};

const rows: Row[] = [];

for (const symbol of symbols) {
  const token = catalogue.find((t) => t.symbol === symbol);
  if (!token) {
    console.error(`\n${symbol}: not in the catalogue`);
    continue;
  }
  const listed = refByAddr.get(token.address.toLowerCase());
  const tokenPrice = listed?.tokenPrice ? Number(listed.tokenPrice) : null;
  console.log(
    `\n${symbol}  ${token.underlying}  per-token reference price ${tokenPrice ? `$${tokenPrice.toFixed(4)}` : "n/a (not in Binance's token list)"}`
  );
  console.log(`${"order".padStart(10)}  ${"vendor".padEnd(11)}${"mode".padEnd(8)}${"tokens out".padStart(14)}${"effective $".padStart(13)}${"vs ref bps".padStart(12)}${"reported impact".padStart(17)}`);
  console.log("-".repeat(88));

  for (const usd of SIZES_USD) {
    const amount = parseUnits(String(usd), USDT_DECIMALS).toString();
    const res = await call<{ code?: number | string; msg?: string; data?: Route[] }>(ENDPOINTS.aggregatorQuote, {
      binanceChainId: CHAIN,
      amount,
      fromTokenAddress: USDT,
      toTokenAddress: token.address,
      userWalletAddress: RECEIVER,
    });

    if (!res.ok) {
      console.log(`${("$" + usd.toLocaleString("en-US")).padStart(10)}  FAILED  ${res.error}${res.body ? "  " + res.body.slice(0, 200) : ""}`);
      rows.push({ symbol, sizeUsd: usd, ms: res.elapsedMs, ok: false, error: `${res.error} ${res.body ?? ""}`.trim(), routes: [] });
      continue;
    }

    const body = res.data;
    const routes = Array.isArray(body.data) ? body.data : [];
    if (routes.length === 0) {
      const why = `no routes returned (code ${body.code}, msg ${body.msg})`;
      console.log(`${("$" + usd.toLocaleString("en-US")).padStart(10)}  ${why}`);
      rows.push({ symbol, sizeUsd: usd, ms: res.elapsedMs, ok: true, error: why, routes: [] });
      continue;
    }

    const parsed = routes.map((r) => {
      const out = r.toTokenAmount ? Number(formatUnits(BigInt(r.toTokenAmount), token.decimals)) : null;
      const eff = out ? usd / out : null;
      return {
        vendor: r.vendorName ?? "?",
        mode: r.executionMode ?? "?",
        best: r.isBest === true,
        tokensOut: out,
        effectivePrice: eff,
        vsReferenceBps: eff && tokenPrice ? ((eff / tokenPrice - 1) * 1e4) : null,
        reportedImpactPct: r.priceImpactPercent ?? null,
        gasUsd: r.estimateGasFee ?? null,
      };
    });
    rows.push({ symbol, sizeUsd: usd, ms: res.elapsedMs, ok: true, routes: parsed });

    parsed.forEach((p, i) => {
      console.log(
        (i === 0 ? ("$" + usd.toLocaleString("en-US")).padStart(10) : "".padStart(10)) +
          "  " +
          (p.vendor + (p.best ? "*" : "")).padEnd(11) +
          p.mode.padEnd(8) +
          (p.tokensOut === null ? "-" : p.tokensOut.toFixed(4)).padStart(14) +
          (p.effectivePrice === null ? "-" : p.effectivePrice.toFixed(4)).padStart(13) +
          (p.vsReferenceBps === null ? "-" : p.vsReferenceBps.toFixed(1)).padStart(12) +
          (p.reportedImpactPct === null ? "-" : `${p.reportedImpactPct}%`).padStart(17)
      );
    });
    await new Promise((r) => setTimeout(r, 400));
  }
}

writeFileSync(
  join(process.cwd(), "data", "binance-quotes.json"),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      note: "Quotes only. Nothing was signed, built or submitted.",
      from: "BSC-USD " + USDT,
      receiver: RECEIVER,
      chain: CHAIN,
      rows,
    },
    null,
    2
  )}\n`
);
console.log("\n* = route Binance marks as best.   vs ref = effective price against the issuer's per-token price, in basis points.");
console.log("wrote data/binance-quotes.json");
