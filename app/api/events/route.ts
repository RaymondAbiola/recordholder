import { loadEvents, loadSweep } from "@/src/snapshot";
import { eventToJson } from "@/src/export";
import { formatUnits } from "viem";

export function GET() {
  const events = loadEvents();
  const sweep = loadSweep();
  if (!events || !sweep) {
    return Response.json({ error: "no snapshot present" }, { status: 503 });
  }

  return Response.json(
    {
      asOfBlock: sweep.blockNumber.toString(),
      asOf: new Date(Number(sweep.timestamp) * 1000).toISOString(),
      securities: sweep.rows.length,
      securitiesWithMovedMultiplier: sweep.divergent.length,
      hiddenShareCount: formatUnits(sweep.hiddenShareCount, 18),
      hiddenShareCountNote:
        "A count of shares across different securities, not a value.",
      corporateActions: events.events.map(eventToJson),
      unknownHistory: events.histories.filter((h) => h.truncated).map((h) => h.symbol),
      securitiesDetail: sweep.divergent.map((r) => ({
        symbol: r.symbol,
        underlying: r.underlying,
        token: r.address,
        uiMultiplier: formatUnits(r.uiMultiplier, 18),
        totalSupplyRaw: formatUnits(r.totalSupply, r.decimals),
        totalSharesOwned: formatUnits(r.totalSupplyUI, r.decimals),
        hidden: formatUnits(r.hiddenSupply, r.decimals),
      })),
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
