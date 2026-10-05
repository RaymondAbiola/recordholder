import { formatUnits, isAddress, type Address } from "viem";
import { client } from "../src/config.js";
import { readToken, readPosition, type TokenState } from "../src/bep677.js";

const KNOWN: Record<string, Address> = {
  TSLAB: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f",
  NVDAB: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436",
  SPCXB: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1",
  SKHYB: "0xCA750eF65f295BBECd685Abf54e82CAf297BDB61",
  IBMB: "0xfa273b076feb8c0fb34e554ae341082323d016a3",
  SOXSB: "0xe28cd11c99af2df76bb8ada4cd0ef3904378280f",
  SPYB: "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8",
};

const [target = "NVDAB", account] = process.argv.slice(2);

const address = isAddress(target) ? (target as Address) : KNOWN[target.toUpperCase()];
if (!address) {
  console.error(`unknown token "${target}". pass an address, or one of: ${Object.keys(KNOWN).join(", ")}`);
  process.exit(1);
}

const t: TokenState = await readToken(client, address);
const fmt = (v: bigint) => formatUnits(v, t.decimals);

console.log(`${t.symbol}  ${t.name}`);
console.log(`  address        ${t.address}`);
console.log(`  capabilities   ${Object.entries(t.capabilities).filter(([, v]) => v).map(([k]) => k).join(" ") || "none"}`);
console.log(`  uiMultiplier   ${formatUnits(t.uiMultiplier, 18)}  (${t.deviationBps >= 0 ? "+" : ""}${t.deviationBps.toFixed(2)} bps)`);
console.log(`  totalSupply    ${fmt(t.totalSupply)}  <- what balanceOf-based tools see`);
console.log(`  totalSupplyUI  ${fmt(t.totalSupplyUI)}  <- shares actually owned`);
console.log(`  hidden         ${fmt(t.hiddenSupply)}`);

if (t.pending) {
  const secs = Number(t.pending.effectiveAt - t.blockTimestamp);
  console.log(`  PENDING        -> ${formatUnits(t.pending.multiplier, 18)} in ${secs}s`);
  console.log(`                 effective ${new Date(Number(t.pending.effectiveAt) * 1000).toISOString()} (via ${t.pending.via})`);
} else {
  console.log(`  pending        none scheduled`);
}

if (account) {
  if (!isAddress(account)) {
    console.error(`\nnot an address: ${account}`);
    process.exit(1);
  }
  const p = await readPosition(client, address, account as Address, { uiMultiplier: t.uiMultiplier });
  console.log(`\nposition ${p.account}`);
  console.log(`  balanceOf      ${fmt(p.raw)}`);
  console.log(`  true shares    ${fmt(p.shares)}`);
  console.log(`  hidden         ${fmt(p.hidden)}`);
}
