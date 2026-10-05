import { client, archiveClient, rpcUrls, KNOWN_EVENT } from "../src/config.js";
import { bep677Abi, INTERFACE_IDS, WAD } from "../src/abi.js";

const SAMPLE = [
  { symbol: "TSLAB", address: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f" },
  { symbol: "NVDAB", address: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436" },
  { symbol: "SPCXB", address: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1" },
  { symbol: "SKHYB", address: "0xCA750eF65f295BBECd685Abf54e82CAf297BDB61" },
] as const;

const pct = (m: bigint) => `${(Number(m - WAD) / 1e16).toFixed(4)}%`;

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failed = true;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};

console.log("rpc");
console.log(`  live    ${rpcUrls.live}`);
console.log(`  archive ${rpcUrls.archive}`);

console.log("\nlive reads");
const head = await client.getBlockNumber();
check(head > 0n, "block number", String(head));

console.log("\nmulticall batching (4 tokens, 3 calls each)");
const reads = await client.multicall({
  contracts: SAMPLE.flatMap((t) => [
    { address: t.address, abi: bep677Abi, functionName: "symbol" },
    { address: t.address, abi: bep677Abi, functionName: "uiMultiplier" },
    { address: t.address, abi: bep677Abi, functionName: "supportsInterface", args: [INTERFACE_IDS.IERC8056Scheduled] },
  ] as const),
  allowFailure: false,
});
for (const [i, t] of SAMPLE.entries()) {
  const symbol = reads[i * 3] as string;
  const mult = reads[i * 3 + 1] as bigint;
  const scheduled = reads[i * 3 + 2] as boolean;
  check(symbol === t.symbol && scheduled, `${t.symbol}`, `multiplier ${pct(mult)}  IERC8056Scheduled=${scheduled}`);
}

console.log("\narchive reads (asserts a known historical fact)");
const [before, after] = await Promise.all([
  archiveClient.readContract({
    address: KNOWN_EVENT.token,
    abi: bep677Abi,
    functionName: "uiMultiplier",
    blockNumber: KNOWN_EVENT.blockBefore,
  }),
  archiveClient.readContract({
    address: KNOWN_EVENT.token,
    abi: bep677Abi,
    functionName: "uiMultiplier",
    blockNumber: KNOWN_EVENT.blockAfter,
  }),
]);
check(before === KNOWN_EVENT.multiplierBefore, `${KNOWN_EVENT.symbol} @ ${KNOWN_EVENT.blockBefore}`, `${pct(before)}`);
check(after === KNOWN_EVENT.multiplierAfter, `${KNOWN_EVENT.symbol} @ ${KNOWN_EVENT.blockAfter}`, `${pct(after)}`);
check(before !== after, "multiplier step detected across the boundary");

console.log(
  failed
    ? "\nFAILED. If only the archive checks failed, BSC_ARCHIVE_RPC_URL does not serve historical state."
    : "\nall checks passed"
);
process.exit(failed ? 1 : 0);
