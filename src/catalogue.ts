import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address } from "viem";

export type Issuer = "bstocks" | "ondo" | "xstocks";

export type CatalogueToken = {
  issuer: Issuer;
  symbol: string;
  /** on-chain name() */
  name: string;
  /** the underlying company or fund, for display */
  underlying: string;
  address: Address;
  decimals: number;
};

export type Catalogue = {
  generatedAt: string;
  chainId: number;
  source: string;
  tokens: CatalogueToken[];
};

const here = dirname(fileURLToPath(import.meta.url));
export const CATALOGUE_PATH = join(here, "..", "data", "tokens.json");

let cached: Catalogue | null = null;

export function loadCatalogue(): Catalogue {
  cached ??= JSON.parse(readFileSync(CATALOGUE_PATH, "utf8")) as Catalogue;
  return cached;
}

export function tokensByIssuer(issuer: Issuer): CatalogueToken[] {
  return loadCatalogue().tokens.filter((t) => t.issuer === issuer);
}

export function findToken(query: string): CatalogueToken | undefined {
  const q = query.toLowerCase();
  return loadCatalogue().tokens.find(
    (t) => t.symbol.toLowerCase() === q || t.address.toLowerCase() === q
  );
}
