import { redirect } from "next/navigation";
import { isAddress } from "viem";

// Keeps the lookup form server-only: no client JS, and a shareable /w/<address> URL.
export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (!isAddress(raw)) redirect("/invalid");
  redirect(`/w/${raw}`);
}
