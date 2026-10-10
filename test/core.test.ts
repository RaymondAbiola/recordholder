import { test } from "node:test";
import assert from "node:assert/strict";
import { toUIAmount, fromUIAmount, deviationBps, WAD } from "../src/bep677";
import { walletToCsv } from "../src/export";
import { preHash, signPreHash, verifySigning } from "../src/binance";
import { pricedHidden } from "../src/pricing";

test("toUIAmount scales raw by the multiplier and floors like the contract", () => {
  assert.equal(toUIAmount(1000n * WAD, WAD), 1000n * WAD);
  assert.equal(toUIAmount(1000n * WAD, (1000778223752807865n)), 1000778223752807865000n);
  assert.equal(toUIAmount(1n, 1500000000000000000n), 1n); // 1.5 floors to 1
});

test("fromUIAmount inverts toUIAmount within one unit", () => {
  const m = 1009026219854107205n;
  const raw = 123456789012345678901n;
  const back = fromUIAmount(toUIAmount(raw, m), m);
  assert.ok(raw - back <= 1n && raw >= back);
});

test("deviationBps is signed and zero at 1.0", () => {
  assert.equal(deviationBps(WAD), 0);
  assert.ok(deviationBps(1009026219854107205n) > 90.2 && deviationBps(1009026219854107205n) < 90.3);
  assert.ok(deviationBps(500000000000000000n) < 0);
});

test("csv neutralises formula injection and quotes awkward names", () => {
  const ev = (underlying: string) => ({
    effectiveAt: 1788998400n, symbol: "X", underlying, address: "0xabc",
    fromMultiplier: WAD, toMultiplier: WAD + 10n ** 15n, block: 1n,
  });
  const report: any = {
    held: [
      { event: ev('=HYPERLINK("http://evil")'), rawAtEvent: WAD, sharesGained: 10n ** 15n, stillHeld: true },
      { event: ev('Smith, Jones & "Co"'), rawAtEvent: WAD, sharesGained: 10n ** 15n, stillHeld: false },
    ],
  };
  const rows = walletToCsv(report).trim().split("\r\n");
  assert.equal(rows.length, 3);
  assert.ok(rows[1]!.includes("\"'=HYPERLINK"), "formula cell is prefixed");
  assert.ok(rows[2]!.includes('"Smith, Jones & ""Co"""'), "quotes doubled");
});

test("binance pre-hash puts /build inside the signed string, and query only when present", () => {
  assert.equal(preHash("GET", "/p", "", "T"), "TGET/build/p");
  assert.equal(preHash("GET", "/p", "a=1", "T"), "TGET/build/p?a=1");
});

test("binance signature is base64 hmac-sha256 and matches a known vector", () => {
  const sig = signPreHash("key", "The quick brown fox jumps over the lazy dog");
  assert.equal(sig, Buffer.from("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8", "hex").toString("base64"));
  assert.deepEqual(verifySigning(), { hmac: true, preHash: true });
});

test("pricing uses the per-share reference price, never the per-token price", () => {
  const sweep: any = { divergent: [
    { symbol: "AAA", address: "0xA", decimals: 18, hiddenSupply: 10n * WAD },
    { symbol: "BBB", address: "0xB", decimals: 18, hiddenSupply: 5n * WAD },
  ] };
  const rwa: any = { fetchedAt: "t", chain: "56", tokens: [
    { platformId: "bstock", address: "0xa", symbol: "AAA", referencePrice: "100" },
  ] };
  const r = pricedHidden(sweep, rwa);
  assert.equal(r.value, 1000);
  assert.equal(r.pricedCount, 1);
  assert.deepEqual(r.unpriced.map((u) => u.symbol), ["BBB"]);
});
