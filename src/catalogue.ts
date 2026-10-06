import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// Resolved from cwd, not from import.meta.url: Next bundles server code into chunks
// whose location bears no relation to src/, so a module-relative path breaks in
// production while working fine under tsx. npm scripts and Vercel both run from root.
export const CATALOGUE_PATH = join(process.cwd(), "data", "tokens.json");

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
