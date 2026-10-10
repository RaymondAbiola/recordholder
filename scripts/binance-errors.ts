// What does the Binance Web3 API say when a request is wrong? Each case is deliberately broken
// in one way, and the status code, content type and body are printed as returned, so the
// developer experience report can quote them. Nothing here changes any state.

import "../src/env";
import { buildSignedRequest, ENDPOINTS, baseUrl, credentials } from "../src/binance";

const BSC = "56";
type Case = { name: string; what: string; run: () => Promise<Response> };

const get = (url: string, headers: Record<string, string>, method = "GET") => fetch(url, { method, headers });
const signed = (path: string, params: Record<string, string | number> = {}, opts = {}) =>
  buildSignedRequest(path, params, "GET", opts);

const cases: Case[] = [
  {
    name: "valid request (control)",
    what: "a correct signed call, to prove the harness itself works",
    run: () => { const r = signed(ENDPOINTS.rwaPlatforms); return get(r.url, r.headers); },
  },
  {
    name: "wrong path",
    what: "a correctly signed request to a path that does not exist",
    run: () => { const r = signed("/api/v1/dex/market/rwa/does-not-exist"); return get(r.url, r.headers); },
  },
  {
    name: "no credentials at all",
    what: "a valid path with none of the X-OC headers",
    run: () => get(`${baseUrl()}${ENDPOINTS.rwaPlatforms}`, { Accept: "application/json" }),
  },
  {
    name: "wrong signature",
    what: "all headers present, signature replaced with the wrong value",
    run: () => { const r = signed(ENDPOINTS.rwaPlatforms); return get(r.url, { ...r.headers, "X-OC-SIGN": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }); },
  },
  {
    name: "stale timestamp",
    what: "a correct signature over a timestamp ten minutes old (default window is 15 seconds)",
    run: () => { const r = signed(ENDPOINTS.rwaPlatforms, {}, { at: new Date(Date.now() - 10 * 60 * 1000) }); return get(r.url, r.headers); },
  },
  {
    name: "spot-style signing",
    what: "the documented Binance spot scheme: hex HMAC over the query string, X-MBX-APIKEY header",
    run: async () => {
      const { createHmac } = await import("node:crypto");
      const { key, secret } = credentials();
      const q = `timestamp=${Date.now()}`;
      const sig = createHmac("sha256", secret).update(q).digest("hex");
      return get(`${baseUrl()}${ENDPOINTS.rwaPlatforms}?${q}&signature=${sig}`, { "X-MBX-APIKEY": key, Accept: "application/json" });
    },
  },
  {
    name: "missing required parameter",
    what: "token prices with no contract address",
    run: () => { const r = signed(ENDPOINTS.rwaPrice, { binanceChainId: BSC }); return get(r.url, r.headers); },
  },
  {
    name: "malformed address",
    what: "balances for an address that is not an address",
    run: () => { const r = signed(ENDPOINTS.allTokenBalances, { address: "0xnope", chains: BSC }); return get(r.url, r.headers); },
  },
  {
    name: "unknown chain id",
    what: "the token list for a chain id that does not exist",
    run: () => { const r = signed(ENDPOINTS.rwaTokens, { binanceChainId: "99999", platformId: "bstock" }); return get(r.url, r.headers); },
  },
  {
    name: "unknown platform",
    what: "the token list for a platform that is not served (xStocks)",
    run: () => { const r = signed(ENDPOINTS.rwaTokens, { binanceChainId: BSC, platformId: "xstocks" }); return get(r.url, r.headers); },
  },
  {
    name: "wrong HTTP method",
    what: "POST to an endpoint documented as GET",
    run: () => { const r = signed(ENDPOINTS.rwaPlatforms); return get(r.url, r.headers, "POST"); },
  },
];

for (const c of cases) {
  const t0 = Date.now();
  try {
    const res = await c.run();
    const text = await res.text();
    const ms = Date.now() - t0;
    let code = "";
    try { const j = JSON.parse(text); code = `body code=${j.code ?? "-"} msg=${JSON.stringify(j.msg ?? j.message ?? j.error ?? "-")}`; } catch { code = "body is not JSON"; }
    console.log(`\n${c.name}\n  ${c.what}\n  HTTP ${res.status}  ${ms}ms  ${res.headers.get("content-type") ?? "no content-type"}\n  ${code}\n  ${text.replace(/\s+/g, " ").slice(0, 260) || "(empty body)"}`);
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    console.log(`\n${c.name}\n  ${c.what}\n  request failed: ${(e as Error).message}${cause ? ` (${cause})` : ""}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
