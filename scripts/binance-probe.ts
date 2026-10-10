// First contact with the Binance Web3 API. Establishes the things that cannot be
// determined from the published client alone: the chain identifier BSC is addressed by,
// which RWA issuance platforms are served, and whether the issuer publishes an
// authoritative token list.

import { loadCatalogue } from "../src/catalogue";
import {
  ENDPOINTS,
  buildSignedRequest,
  call,
  describeCredentials,
  verifySigning,
  baseUrl,
  BinanceConfigError,
} from "../src/binance";

const dryRun = process.argv.includes("--dry-run");

const checks = verifySigning();
console.log("signing self-check");
console.log(`  hmac-sha256 vector   ${checks.hmac ? "ok" : "FAILED"}`);
console.log(`  pre-hash assembly    ${checks.preHash ? "ok" : "FAILED"}`);
console.log(`  credentials          ${describeCredentials()}`);
console.log(`  base url             ${baseUrl()}`);
if (!checks.hmac || !checks.preHash) process.exit(1);

if (dryRun) {
  try {
    const req = buildSignedRequest(ENDPOINTS.rwaPlatforms);
    console.log("\ndry run, nothing sent");
    console.log(`  ${req.method} ${req.url}`);
    console.log(`  signed string: ${req.preHash}`);
    console.log("  headers: X-OC-APIKEY <redacted>, X-OC-TIMESTAMP, X-OC-SIGN <redacted>,");
    console.log("           X-OC-RECV-WINDOW 15000, X-OC-NONCE");
  } catch (e) {
    console.log(`\ndry run: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(0);
}

const probe = async (label: string, path: string, params: Record<string, string | number> = {}) => {
  process.stdout.write(`\n${label}\n  ${path}\n`);
  try {
    const res = await call<unknown>(path, params);
    console.log(`  ${res.elapsedMs}ms  ${res.ok ? `HTTP ${res.status}` : res.error}`);
    if (!res.ok) {
      if (res.body) console.log(`  body: ${res.body}`);
      return null;
    }
    return res.data;
  } catch (e) {
    if (e instanceof BinanceConfigError) {
      console.error(`  ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
};

const chains = await probe("supported chains", ENDPOINTS.supportedChains);
if (chains) {
  const list = (chains as { data?: { binanceChainId?: string; name?: string }[] }).data ?? [];
  console.log(`  ${list.length} chains: ${list.map((c) => `${c.binanceChainId}=${c.name}`).join(", ")}`);
  const bsc = list.find((c) => /^(bnb|bsc|binance smart)/i.test(c.name ?? ""));
  console.log(`  BSC: ${bsc ? `binanceChainId "${bsc.binanceChainId}"` : "not found by name, read the list above"}`);
}

const platforms = await probe("rwa issuance platforms", ENDPOINTS.rwaPlatforms);
if (platforms) {
  console.log(`  ${JSON.stringify(platforms).slice(0, 700)}`);
  console.log("\n  NOTE: the published python client's platform enum lists only");
  console.log("  'ondo' and 'bstock'. If xStocks is absent above too, that is worth");
  console.log("  recording: the hackathon names all three as acceptable.");
}

if (!chains && !platforms) {
  console.error("\nboth calls failed, so nothing below this point is meaningful.");
  console.error("Fix the cause shown above first, then re-run.");
  process.exit(1);
}

const chainId = process.env.BINANCE_BSC_CHAIN_ID || "56";

const tokens = await probe("rwa token list, bstock", ENDPOINTS.rwaTokens, {
  binanceChainId: chainId,
  platformId: "bstock",
});
if (tokens) {
  const ours = loadCatalogue().tokens.length;
  const addresses = new Set(
    (JSON.stringify(tokens).match(/0x[a-fA-F0-9]{40}/g) ?? []).map((a) => a.toLowerCase())
  );
  console.log(`  distinct addresses returned: ${addresses.size}`);
  console.log(`  our catalogue, scraped from coingecko: ${ours}`);
  if (addresses.size > 0) {
    const mine = new Set(loadCatalogue().tokens.map((t) => t.address.toLowerCase()));
    const missing = [...addresses].filter((a) => !mine.has(a));
    const extra = [...mine].filter((a) => !addresses.has(a));
    console.log(`  in Binance's list but not ours: ${missing.length}`);
    console.log(`  in ours but not Binance's:      ${extra.length}`);
  }
}
