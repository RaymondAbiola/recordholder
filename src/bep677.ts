import type { Address, PublicClient } from "viem";
import { bep677Abi, INTERFACE_IDS } from "./abi";

// --- the whole correction, with no dependencies ---------------------------
// Under ERC-8056 / BEP-677, balanceOf() and totalSupply() return RAW amounts.
// The share count a holder actually owns is the raw amount scaled by the
// token's UI multiplier. Copy these two functions and you have the fix.

export const WAD = 10n ** 18n;

export function toUIAmount(raw: bigint, uiMultiplier: bigint): bigint {
  return (raw * uiMultiplier) / WAD;
}

export function fromUIAmount(ui: bigint, uiMultiplier: bigint): bigint {
  return (ui * WAD) / uiMultiplier;
}

// -------------------------------------------------------------------------

export type Capabilities = {
  core: boolean;
  pending: boolean;
  conversion: boolean;
  balances: boolean;
  scheduled: boolean;
};

export type PendingChange = {
  multiplier: bigint;
  effectiveAt: bigint;
  /** how the change was detected, since the two paths have different reliability */
  via: "scheduled" | "effectiveAt";
};

export type TokenState = {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  capabilities: Capabilities;
  uiMultiplier: bigint;
  totalSupply: bigint;
  /** raw * multiplier, read from chain where exposed, otherwise computed */
  totalSupplyUI: bigint;
  /** shares that exist but that no balanceOf-based tool reports */
  hiddenSupply: bigint;
  /** multiplier distance from 1.0 in basis points, negative after a reverse split */
  deviationBps: number;
  pending: PendingChange | null;
  blockTimestamp: bigint;
};

export type Position = {
  account: Address;
  raw: bigint;
  shares: bigint;
  hidden: bigint;
};

export function deviationBps(uiMultiplier: bigint): number {
  return Number(((uiMultiplier - WAD) * 10_000n * 1000n) / WAD) / 1000;
}

export async function detectCapabilities(
  client: PublicClient,
  address: Address
): Promise<Capabilities> {
  const ids = [
    INTERFACE_IDS.IScaledUIAmount,
    INTERFACE_IDS.IScaledUIAmountNewUIMultiplier,
    INTERFACE_IDS.IScaledUIAmountConversion,
    INTERFACE_IDS.IScaledUIAmountBalances,
    INTERFACE_IDS.IERC8056Scheduled,
  ] as const;

  const res = await client.multicall({
    contracts: ids.map((id) => ({
      address,
      abi: bep677Abi,
      functionName: "supportsInterface" as const,
      args: [id] as const,
    })),
  });

  const ok = (i: number) => res[i]?.status === "success" && res[i]?.result === true;
  return {
    core: ok(0),
    pending: ok(1),
    conversion: ok(2),
    balances: ok(3),
    scheduled: ok(4),
  };
}

/**
 * Resolve whether a multiplier change is genuinely pending.
 *
 * newUIMultiplier() alone cannot answer this: spec 4.2 has it keep returning the
 * stored next value after that value is already active, so it equals uiMultiplier()
 * both before a change is scheduled and after one has landed. Tokens carrying the
 * BSC-only IERC8056Scheduled extension expose hasPendingMultiplier() to settle it
 * directly; everything else has to fall back on effectiveAt() > now.
 */
async function readPending(
  client: PublicClient,
  address: Address,
  caps: Capabilities,
  now: bigint
): Promise<PendingChange | null> {
  if (caps.scheduled) {
    const [has, tuple] = await Promise.all([
      client.readContract({ address, abi: bep677Abi, functionName: "hasPendingMultiplier" }),
      client.readContract({ address, abi: bep677Abi, functionName: "pendingMultiplier" }),
    ]);
    if (!has) return null;
    const [multiplier, effectiveAt] = tuple as readonly [bigint, bigint];
    return { multiplier, effectiveAt, via: "scheduled" };
  }

  if (!caps.pending) return null;

  const [multiplier, effectiveAt] = await Promise.all([
    client.readContract({ address, abi: bep677Abi, functionName: "newUIMultiplier" }),
    client.readContract({ address, abi: bep677Abi, functionName: "effectiveAt" }),
  ]);
  if (effectiveAt <= now) return null;
  return { multiplier, effectiveAt, via: "effectiveAt" };
}

export async function readToken(
  client: PublicClient,
  address: Address,
  opts: { capabilities?: Capabilities } = {}
): Promise<TokenState> {
  const capabilities = opts.capabilities ?? (await detectCapabilities(client, address));

  const [name, symbol, decimals, totalSupply, uiMultiplier] = await Promise.all([
    client.readContract({ address, abi: bep677Abi, functionName: "name" }),
    client.readContract({ address, abi: bep677Abi, functionName: "symbol" }),
    client.readContract({ address, abi: bep677Abi, functionName: "decimals" }),
    client.readContract({ address, abi: bep677Abi, functionName: "totalSupply" }),
    client.readContract({ address, abi: bep677Abi, functionName: "uiMultiplier" }),
  ]);

  const block = await client.getBlock();
  const pending = await readPending(client, address, capabilities, block.timestamp);

  const totalSupplyUI = capabilities.balances
    ? await client.readContract({ address, abi: bep677Abi, functionName: "totalSupplyUI" })
    : toUIAmount(totalSupply, uiMultiplier);

  return {
    address,
    name: name.trim(),
    symbol,
    decimals,
    capabilities,
    uiMultiplier,
    totalSupply,
    totalSupplyUI,
    hiddenSupply: totalSupplyUI - totalSupply,
    deviationBps: deviationBps(uiMultiplier),
    pending,
    blockTimestamp: block.timestamp,
  };
}

export async function readPosition(
  client: PublicClient,
  address: Address,
  account: Address,
  opts: { uiMultiplier?: bigint } = {}
): Promise<Position> {
  const raw = await client.readContract({
    address,
    abi: bep677Abi,
    functionName: "balanceOf",
    args: [account],
  });

  const multiplier =
    opts.uiMultiplier ??
    (await client.readContract({ address, abi: bep677Abi, functionName: "uiMultiplier" }));

  const shares = toUIAmount(raw, multiplier);
  return { account, raw, shares, hidden: shares - raw };
}
