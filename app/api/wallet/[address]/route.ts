import { isAddress, getAddress, type Address } from "viem";
import { client, archiveClient } from "@/src/config";
import { loadEvents } from "@/src/snapshot";
import { walletReport } from "@/src/wallet";
import { walletToJson, walletToCsv } from "@/src/export";

// One request fans out to an archive read per recorded action, so let the CDN absorb repeats.
const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  if (!isAddress(address)) {
    return Response.json({ error: "not a valid address" }, { status: 400 });
  }
  const snapshot = loadEvents();
  if (!snapshot) {
    return Response.json({ error: "no event snapshot present" }, { status: 503 });
  }

  const account = getAddress(address) as Address;
  const report = await walletReport(client, archiveClient, account, snapshot.events);

  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new Response(walletToCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="recordholder-${account}.csv"`,
        "Cache-Control": CACHE,
      },
    });
  }

  return Response.json(walletToJson(report, snapshot.events.length), {
    headers: { "Cache-Control": CACHE },
  });
}
