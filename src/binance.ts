// Signed Binance Web3 API client. Server side only: requests are authenticated with
// HMAC-SHA256 over the secret, so this must never be imported into a client component.
//
// The Web3 API does NOT use the classic Binance spot scheme. It signs a structured
// pre-hash and passes credentials in X-OC-* headers:
//
//   timestamp = ISO 8601 with milliseconds, e.g. 2026-10-06T09:12:33.481Z
//   preHash   = timestamp + METHOD + "/build" + path + ("?" + query if query) + body
//   signature = base64( HMAC_SHA256(secret, preHash) )
//
// Note the literal "/build" inside the signed string, the base64 rather than hex digest,
// and that the timestamp is a header rather than a query parameter. Starting from the
// documented spot signing scheme produces a signature that is rejected every time.

import "./env";
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_BASE = "https://web3.binance.com/build";
const SIGNED_PATH_PREFIX = "/build";

export const ENDPOINTS = {
  supportedChains: "/api/v1/dex/balance/supported/chain",
  tokenBalances: "/api/v1/dex/balance/token-balances-by-address",
  allTokenBalances: "/api/v1/dex/balance/all-token-balances-by-address",
  aggregatorQuote: "/api/v1/dex/aggregator/quote",
  rwaPlatforms: "/api/v1/dex/market/rwa/platforms",
  rwaTokens: "/api/v1/dex/market/rwa/tokens",
  rwaPrice: "/api/v1/dex/market/rwa/price",
  rwaSearch: "/api/v1/dex/market/rwa/search",
  rwaUnderlyingProfile: "/api/v1/dex/market/rwa/underlying-profile",
  rwaUnderlyingMarket: "/api/v1/dex/market/rwa/underlying-market",
} as const;

export type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

export class BinanceConfigError extends Error {}

export function credentials(): { key: string; secret: string } {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) {
    throw new BinanceConfigError(
      "BINANCE_API_KEY and BINANCE_API_SECRET must be set in .env.local"
    );
  }
  return { key, secret };
}

export const baseUrl = (): string => process.env.BINANCE_W3W_BASE_URL || DEFAULT_BASE;

export function isoTimestamp(at: Date = new Date()): string {
  return `${at.toISOString().slice(0, 23)}Z`;
}

/** Insertion order is preserved: the server verifies the string we signed, not a sorted one. */
export function encodeParams(params: Record<string, string | number>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return q.toString();
}

export function preHash(
  method: "GET" | "POST",
  path: string,
  query: string,
  timestamp: string,
  body = ""
): string {
  const head = `${timestamp}${method}${SIGNED_PATH_PREFIX}${path}`;
  return query ? `${head}?${query}${body}` : `${head}${body}`;
}

export function signPreHash(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

export type SignedRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  preHash: string;
};

/**
 * Only a root-relative path is accepted. Anything carrying a scheme, host or
 * protocol-relative prefix is rejected, so a value arriving from a request cannot turn
 * this into an open proxy against our own authenticated quota.
 */
function assertPath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new BinanceConfigError(`endpoint must be a root-relative path, got: ${path}`);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.includes("://")) {
    throw new BinanceConfigError(`endpoint must not contain a scheme: ${path}`);
  }
}

export function buildSignedRequest(
  path: string,
  params: Record<string, string | number> = {},
  method: "GET" | "POST" = "GET",
  opts: { recvWindow?: number; nonce?: string; at?: Date; body?: string } = {}
): SignedRequest {
  assertPath(path);
  const { key, secret } = credentials();

  const timestamp = isoTimestamp(opts.at);
  const query = encodeParams(params);
  const body = opts.body ?? "";
  const hash = preHash(method, path, query, timestamp, body);

  return {
    url: query ? `${baseUrl()}${path}?${query}` : `${baseUrl()}${path}`,
    method,
    headers: {
      "X-OC-APIKEY": key,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": signPreHash(secret, hash),
      "X-OC-RECV-WINDOW": String(opts.recvWindow ?? 15000),
      "X-OC-NONCE": opts.nonce ?? "",
      Accept: "application/json",
    },
    preHash: hash,
  };
}

export type CallResult<T> =
  | { ok: true; status: number; data: T; elapsedMs: number }
  | { ok: false; status: number | null; error: string; body?: string; elapsedMs: number };

export async function call<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
  method: "GET" | "POST" = "GET"
): Promise<CallResult<T>> {
  const req = buildSignedRequest(path, params, method);
  const started = Date.now();

  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers });
    const elapsedMs = Date.now() - started;
    const text = await res.text();

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, body: text.slice(0, 800), elapsedMs };
    }
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) as T, elapsedMs };
    } catch {
      return { ok: false, status: res.status, error: "response was not JSON", body: text.slice(0, 800), elapsedMs };
    }
  } catch (e) {
    return {
      ok: false,
      status: null,
      error: networkError(e),
      elapsedMs: Date.now() - started,
    };
  }
}

// Node's fetch reports every network failure as "fetch failed" and hides the reason in
// error.cause. The reason is the useful part: ENOTFOUND means the name did not resolve
// (VPN or DNS), ETIMEDOUT or ECONNREFUSED mean it resolved and the connection was refused.
function networkError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message;
  const hint =
    cause?.code === "ENOTFOUND"
      ? " (name did not resolve: is the VPN on? binance.com is unreachable without one in some regions)"
      : "";
  return detail ? `${e.message}: ${detail}${hint}` : e.message;
}

/** Shape only, so a key never reaches a log, a transcript or an error message. */
export function describeCredentials(): string {
  const shape = (v: string | undefined) => (v ? `present, ${v.length} chars` : "MISSING");
  return `key: ${shape(process.env.BINANCE_API_KEY)}, secret: ${shape(process.env.BINANCE_API_SECRET)}`;
}

/**
 * Checks the primitive against a published HMAC-SHA256 vector, and the assembled
 * pre-hash against a fixed expected string, so a signing regression is caught locally
 * rather than as an opaque 401.
 */
export function verifySigning(): { hmac: boolean; preHash: boolean } {
  const expectedHex = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
  const gotHex = createHmac("sha256", "key")
    .update("The quick brown fox jumps over the lazy dog")
    .digest("hex");

  const hmac =
    gotHex.length === expectedHex.length &&
    timingSafeEqual(Buffer.from(gotHex, "hex"), Buffer.from(expectedHex, "hex"));

  const built = preHash(
    "GET",
    "/api/v1/dex/market/rwa/price",
    "binanceChainId=56&tokenContractAddresses=0xabc",
    "2026-10-06T00:00:00.000Z"
  );
  const expected =
    "2026-10-06T00:00:00.000ZGET/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0xabc";

  return { hmac, preHash: built === expected };
}
