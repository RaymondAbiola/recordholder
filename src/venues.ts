import type { Address, PublicClient } from "viem";
import { bep677Abi } from "./abi";
import { toUIAmount } from "./bep677";
import { loadCatalogue, type CatalogueToken } from "./catalogue";
import type { SweepRow } from "./sweep";

export type Venue = {
  key: string;
  name: string;
  detail: string;
  /** contracts that actually custody the tokens */
  holders: { address: Address; label: string }[];
};

export const VENUES: Venue[] = [
  {
    key: "venus",
    name: "Venus Protocol",
    detail: "Core pool markets accepting tokenized stocks as collateral",
    holders: [
      { address: "0x97421799419Eb782628e73e7220d8E0A207469a3", label: "vTSLAB" },
      { address: "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371", label: "vNVDAB" },
      { address: "0xC36dFaCc7a125859C106F29b9F2d874CCF29A55A", label: "vSPCXB" },
      { address: "0x3E281461efb3D53EC20DB207674373Ed8Ef3BbA9", label: "vSKHYB" },
    ],
  },
  {
    key: "lista",
    name: "Lista DAO",
    detail: "Moolah lending markets",
    holders: [{ address: "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C", label: "Moolah" }],
  },
];

/**
 * What was actually checked in Venus's price path, recorded with addresses so the
 * claim can be re-run rather than taken on trust.
 *
 * Deliberately narrow. This establishes that nothing on chain reads the multiplier.
 * It does NOT establish whether the off-chain feed quotes per share or per raw token,
 * which is not determinable from chain data and is not claimed anywhere.
 */
export const VENUS_PRICE_PATH_AUDIT = {
  checkedOn: "2026-10-03",
  contracts: [
    { role: "ResilientOracle implementation", address: "0x90d840f463c4e341e37b1d51b1ab16bc5b34865c" },
    { role: "Main price feed implementation", address: "0x98f02c2a4ec47d230ffe14764d227cc1940e9fe2" },
    { role: "Pivot price feed implementation", address: "0x5499aa0d1a7ee06b92f3d9213774ae848bc8c9a4" },
  ],
  selectorsSearched: ["uiMultiplier()", "toUIAmount(uint256)", "balanceOfUI(address)"],
  occurrencesFound: 0,
  feedDescription: "NVDAB/USD",
  stalenessToleranceSeconds: 3900,
  borrowingEnabled: false,
  borrowCap: 0,
} as const;

export type VenueHolding = {
  token: CatalogueToken;
  holderLabel: string;
  raw: bigint;
  shares: bigint;
  hidden: bigint;
};

export type VenueExposure = {
  venue: Venue;
  holdings: VenueHolding[];
  tokenCount: number;
  hiddenTotal: bigint;
};

const CHUNK = 40;
const chunk = <T,>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Exposure across the venues, for divergent tokens only. Multipliers come from the
 * committed sweep rather than being re-read, so this costs one balanceOf per pair.
 */
export async function readExposure(
  client: PublicClient,
  divergent: readonly SweepRow[]
): Promise<VenueExposure[]> {
  const byAddress = new Map(loadCatalogue().tokens.map((t) => [t.address, t]));

  const pairs = VENUES.flatMap((venue) =>
    venue.holders.flatMap((holder) =>
      divergent.map((row) => ({ venue, holder, row }))
    )
  );

  const balances = new Map<string, bigint>();
  for (const batch of chunk(pairs, CHUNK)) {
    const res = await client.multicall({
      contracts: batch.map((p) => ({
        address: p.row.address,
        abi: bep677Abi,
        functionName: "balanceOf" as const,
        args: [p.holder.address] as const,
      })),
    });
    batch.forEach((p, i) => {
      const r = res[i];
      if (r?.status === "success") {
        balances.set(`${p.venue.key}:${p.holder.address}:${p.row.address}`, r.result as bigint);
      }
    });
  }

  return VENUES.map((venue) => {
    const holdings: VenueHolding[] = [];
    for (const holder of venue.holders) {
      for (const row of divergent) {
        const raw = balances.get(`${venue.key}:${holder.address}:${row.address}`) ?? 0n;
        if (raw === 0n) continue;
        const token = byAddress.get(row.address);
        if (!token) continue;
        const shares = toUIAmount(raw, row.uiMultiplier);
        holdings.push({ token, holderLabel: holder.label, raw, shares, hidden: shares - raw });
      }
    }
    holdings.sort((a, b) => (b.hidden > a.hidden ? 1 : b.hidden < a.hidden ? -1 : 0));
    return {
      venue,
      holdings,
      tokenCount: new Set(holdings.map((h) => h.token.address)).size,
      hiddenTotal: holdings.reduce((a, h) => a + h.hidden, 0n),
    };
  });
}
