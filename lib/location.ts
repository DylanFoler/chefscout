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

// --- Region-accuracy geo check ----------------------------------------------
// The scan trusts the discovery model that a returned maker operates in the
// searched region. That trust is too loose — the model name-drops famous makers
// from other cities (e.g. @koffeteria, a Houston bakery, surfaced for "Denver"
// AND "Atlanta"). We can't generally verify a city is "in" a region (suburbs,
// metros), but we CAN catch a confident contradiction at the STATE level using
// the maker's real city from their Instagram business address ("Houston, Texas").
// Deliberately conservative: it only drops on an unambiguous single-state
// mismatch, and never fires for regions it can't resolve or multi-state metros —
// so it never re-introduces the over-dropping that once broke state scans.

// Canonical lowercased state names + abbreviation -> name (50 states + DC).
const STATE_ABBR: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};
const STATE_NAMES = new Set(Object.values(STATE_ABBR));

// Resolve a token (state name or abbreviation) to a canonical state name, or null.
function toState(token: string): string | null {
  const t = token.trim().toLowerCase();
  if (STATE_NAMES.has(t)) return t;
  return STATE_ABBR[t] ?? null;
}

// Major US metros / cities -> canonical state. Partial coverage is fine: an
// unmapped region simply yields no geo-drop (we fall back to trusting the model).
const METRO_TO_STATE: Record<string, string> = {
  "los angeles": "california", "san francisco": "california",
  "bay area": "california", "san diego": "california", "san jose": "california",
  sacramento: "california", oakland: "california", "orange county": "california",
  denver: "colorado", boulder: "colorado", atlanta: "georgia",
  seattle: "washington", chicago: "illinois", houston: "texas", dallas: "texas",
  austin: "texas", "san antonio": "texas", "fort worth": "texas", miami: "florida",
  orlando: "florida", tampa: "florida", jacksonville: "florida", phoenix: "arizona",
  tucson: "arizona", "las vegas": "nevada", boston: "massachusetts",
  detroit: "michigan", minneapolis: "minnesota", "twin cities": "minnesota",
  nashville: "tennessee", "salt lake city": "utah", "new orleans": "louisiana",
  pittsburgh: "pennsylvania", columbus: "ohio", cleveland: "ohio",
  indianapolis: "indiana", milwaukee: "wisconsin", "oklahoma city": "oklahoma",
  honolulu: "hawaii", albuquerque: "new mexico", "santa fe": "new mexico",
  richmond: "virginia", raleigh: "north carolina", "des moines": "iowa",
  "little rock": "arkansas", birmingham: "alabama", boise: "idaho",
  providence: "rhode island", buffalo: "new york",
};

// Regions whose metro legitimately spans multiple states — disable the state
// check entirely (keep all) so we never drop a real local just over a state line.
const MULTI_STATE_METROS = new Set([
  "new york", "nyc", "washington", "dc", "dmv", "kansas city", "portland",
  "memphis", "cincinnati", "st louis", "saint louis", "philadelphia", "philly",
  "charlotte", "louisville", "omaha", "chattanooga", "tahoe",
]);

// The canonical state for a (raw) region string, or null if we can't resolve it.
export function regionState(region: string): string | null {
  const loc = resolveLocation(region);
  // 1. The whole region is a state name/abbrev ("new mexico", "co").
  const whole = toState(loc);
  if (whole) return whole;
  // 2. A state appears as a token ("santa fe, nm", "austin texas").
  for (const tok of loc.split(/[\s,]+/).filter(Boolean)) {
    const s = toState(tok);
    if (s) return s;
  }
  // 3. A known metro/city.
  return METRO_TO_STATE[loc] ?? null;
}

// The canonical state from an IG business-address city string ("Houston, Texas"
// or "Houston, TX"), or null when it's city-only / unrecognized.
export function cityState(igCity: string | null | undefined): string | null {
  if (!igCity) return null;
  const parts = igCity.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;
  return toState(parts[parts.length - 1]);
}

// True only on a confident single-state mismatch between the maker's real city
// and the searched region. Conservative — false (keep) whenever we can't be sure:
// no IG city, region not resolvable to a state, multi-state metro, or a city-only
// IG string.
export function geoContradicts(
  region: string,
  igCity: string | null | undefined
): boolean {
  if (!igCity) return false;
  if (MULTI_STATE_METROS.has(resolveLocation(region))) return false;
  const rs = regionState(region);
  if (!rs) return false;
  const cs = cityState(igCity);
  if (!cs) return false;
  return cs !== rs;
}
