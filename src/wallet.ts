import type { Address, PublicClient } from "viem";
import { bep677Abi } from "./abi.js";
import { WAD, toUIAmount } from "./bep677.js";
import { loadCatalogue, type CatalogueToken } from "./catalogue.js";
import { mapLimit, type MultiplierEvent } from "./events.js";

export type WalletPosition = {
  token: CatalogueToken;
  uiMultiplier: bigint;
  raw: bigint;
  shares: bigint;
  /** shares owned that no balanceOf-based tool reports */
  hidden: bigint;
};

export type HeldEvent = {
  event: MultiplierEvent;
  /** raw balance at the last block before the new multiplier took effect */
  rawAtEvent: bigint;
  /** shares credited by the step. the raw balance does not move, which is why nothing shows this */
  sharesGained: bigint;
  /** whether the account still holds any of this token */
  stillHeld: boolean;
};

export type WalletReport = {
  account: Address;
  positions: WalletPosition[];
  held: HeldEvent[];
  missedEntirely: MultiplierEvent[];
  hiddenNow: bigint;
  sharesGainedTotal: bigint;
};

const CHUNK = 40;
const chunk = <T,>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Current raw balance and multiplier for every catalogue token the account holds. */
export async function readPositions(
  client: PublicClient,
  account: Address,
  tokens: readonly CatalogueToken[] = loadCatalogue().tokens
): Promise<WalletPosition[]> {
  const positions: WalletPosition[] = [];

  for (const batch of chunk(tokens, CHUNK)) {
    const res = await client.multicall({
      contracts: batch.flatMap((t) => [
        { address: t.address, abi: bep677Abi, functionName: "balanceOf", args: [account] },
        { address: t.address, abi: bep677Abi, functionName: "uiMultiplier" },
      ] as const),
    });

    batch.forEach((token, i) => {
      const bal = res[i * 2];
      const mult = res[i * 2 + 1];
      if (bal?.status !== "success" || mult?.status !== "success") return;
      const raw = bal.result as bigint;
      if (raw === 0n) return;
      const uiMultiplier = mult.result as bigint;
      const shares = toUIAmount(raw, uiMultiplier);
      positions.push({ token, uiMultiplier, raw, shares, hidden: shares - raw });
    });
  }

  return positions.sort((a, b) => (b.hidden > a.hidden ? 1 : b.hidden < a.hidden ? -1 : 0));
}

/**
 * Which corporate actions this account held through.
 *
 * Checks every event token, not just currently held ones: a position closed after
 * the event still received it. The balance is read one block before the multiplier
 * changed, since the raw amount is unaffected by the step itself.
 */
export async function attributeEvents(
  archiveClient: PublicClient,
  account: Address,
  events: readonly MultiplierEvent[],
  heldNow: ReadonlySet<string>,
  concurrency = 5
): Promise<{ held: HeldEvent[]; missedEntirely: MultiplierEvent[] }> {
  const results = await mapLimit(events, concurrency, async (event) => {
    let rawAtEvent: bigint;
    try {
      rawAtEvent = await archiveClient.readContract({
        address: event.address,
        abi: bep677Abi,
        functionName: "balanceOf",
        args: [account],
        blockNumber: event.block - 1n,
      });
    } catch {
      return null;
    }
    if (rawAtEvent === 0n) return null;

    // The contract floors its own conversions, so a dust balance can hold through a
    // step and be credited nothing. Nothing was paid, so it is not a held event.
    const sharesGained = (rawAtEvent * (event.toMultiplier - event.fromMultiplier)) / WAD;
    if (sharesGained === 0n) return null;

    return {
      event,
      rawAtEvent,
      sharesGained,
      stillHeld: heldNow.has(event.address.toLowerCase()),
    } satisfies HeldEvent;
  });

  const held = results.filter((r): r is HeldEvent => r !== null);
  const heldAddrs = new Set(held.map((h) => h.event.address));
  return { held, missedEntirely: events.filter((e) => !heldAddrs.has(e.address)) };
}

export async function walletReport(
  client: PublicClient,
  archiveClient: PublicClient,
  account: Address,
  events: readonly MultiplierEvent[]
): Promise<WalletReport> {
  const positions = await readPositions(client, account);
  const heldNow = new Set(positions.map((p) => p.token.address.toLowerCase()));
  const { held, missedEntirely } = await attributeEvents(archiveClient, account, events, heldNow);

  return {
    account,
    positions,
    held: held.sort((a, b) => Number(a.event.effectiveAt - b.event.effectiveAt)),
    missedEntirely,
    hiddenNow: positions.reduce((a, p) => a + p.hidden, 0n),
    sharesGainedTotal: held.reduce((a, h) => a + h.sharesGained, 0n),
  };
}
