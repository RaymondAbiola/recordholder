import "./env";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

const RPC = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";

// blastapi's public endpoint is the only free one of six tested that serves
// historical eth_call. It is rate limited, so set BSC_ARCHIVE_RPC_URL for real work.
const ARCHIVE_RPC =
  process.env.BSC_ARCHIVE_RPC_URL || "https://bsc-mainnet.public.blastapi.io";

export const client = createPublicClient({
  chain: bsc,
  transport: http(RPC),
  batch: { multicall: true },
});

export const archiveClient = createPublicClient({
  chain: bsc,
  transport: http(ARCHIVE_RPC),
  batch: { multicall: true },
});

export const rpcUrls = { live: RPC, archive: ARCHIVE_RPC };

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

// NVDAB's first multiplier move: scheduled at 23:55:10 UTC, effective at exactly
// midnight 2026-09-10. Used as a fixed assertion that archive reads really work.
export const KNOWN_EVENT = {
  token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436",
  symbol: "NVDAB",
  blockBefore: 120970450n,
  blockAfter: 120970451n,
  multiplierBefore: 1000000000000000000n,
  multiplierAfter: 1000778223752807865n,
  scheduledAtBlock: 120969809n,
  noticeSeconds: 290,
} as const;
