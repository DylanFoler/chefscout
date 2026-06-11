import { Seller } from "@/lib/types";

// Common location shorthand so the team never has to remember exact spellings.
// Keys are matched against the whole trimmed query (exact-token aliasing).
export const LOCATION_ALIASES: Record<string, string> = {
  nyc: "new york",
  "new york city": "new york",
  la: "los angeles",
  sf: "san francisco",
  chi: "chicago",
  bay: "bay area",
  tristate: "tri-state",
  "tri state": "tri-state",
  brooklyn: "brooklyn",
  manhattan: "manhattan",
};

// Expand a known alias to its canonical form; otherwise return the input lowercased/trimmed.
export function resolveLocation(query: string): string {
  const lower = query.toLowerCase().trim();
  return LOCATION_ALIASES[lower] ?? lower;
}

// True if the seller's neighborhood, city, or metro_area contains the (alias-resolved) query.
// An empty query matches everything.
export function matchesLocation(seller: Seller, query: string): boolean {
  if (!query.trim()) return true;
  const loc = resolveLocation(query);
  return (
    seller.neighborhood.toLowerCase().includes(loc) ||
    seller.city.toLowerCase().includes(loc) ||
    seller.metro_area.toLowerCase().includes(loc)
  );
}
