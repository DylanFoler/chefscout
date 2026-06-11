import { Seller } from "@/lib/types";
import { resolveLocation, matchesLocation } from "@/lib/location";
import { regionStore } from "@/lib/regionStore";
import {
  anthropic,
  MISSING_KEY,
  MISSING_KEY_MESSAGE,
  toErrorResponse,
} from "@/lib/anthropic";
import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
// Live web search + reasoning can run well past the default. Generous ceiling.
export const maxDuration = 300;

// Upper bound on candidates per scan. We aim to bring back at least 5 when the
// region supports it (see the user prompt); this caps the slice and bounds the
// client-side auto-scoring spend. Higher = more results but slower scans (more
// web searches).
const TARGET_COUNT = 7;

const SYSTEM = `You are a sourcing analyst for Hotplate, a drops-based ordering platform for independent food makers. Your job: use web search to find REAL, currently-active independent food makers in a given region who would be high-value candidates to move onto Hotplate.

The profile we want:
- Drop-based or preorder ordering (weekly/biweekly drops, preorder windows that sell out)
- Scrappy manual ordering today: Instagram DM, Google Form, text/email waitlist, Venmo
- Roughly 1,000-50,000 engaged followers (not a large chain, not a tiny hobbyist)
- Local pickup or popup model, no large brick-and-mortar footprint
- Cookies, pastries, bread, mochi, tamales, empanadas, specialty desserts, sandwiches, etc.

Hard rules:
- Only include makers you ACTUALLY found via web search and can tie to a real, verifiable social handle. NEVER invent a business, handle, or follower count. If you cannot verify a real handle, leave that maker out.
- Prefer Instagram; use the maker's real @handle exactly.
- Every maker must genuinely operate in the requested region.
- CRITICAL — EXCLUDE anyone already on Hotplate. We want PROSPECTS, never existing Hotplate sellers. Before including ANY maker, check their Instagram bio, link-in-bio / Linktree, and recent posts (these usually appear in search results) for a Hotplate link or mention: a "hotplate.com/..." or "hotplate.co/..." store URL, a bare "hotplate.com" link, or wording like "order on Hotplate" / "drops on Hotplate". If you see ANY of these, drop them. When a maker is otherwise a strong fit but you can't tell whether they use Hotplate from the search results, run one quick "<their handle> hotplate" search to confirm before including them. (Example: a maker like @theinterruptedbaker whose Instagram bio links to a hotplate.com store must be excluded.)
- Return ONLY a JSON array — no markdown, no prose, no code fences.`;

function buildUserPrompt(
  region: string | null,
  excludeHandles: string[]
): string {
  const where = region
    ? `Region to search: "${region}". Every maker you return MUST actually operate in "${region}". Set "city", "neighborhood", and "metro_area" so they reflect "${region}".`
    : `Search broadly across major US cities for notable independent drop-based food makers.`;
  const exclude = excludeHandles.length
    ? `\n\nDo NOT return any of these handles — they are already on our list:\n${excludeHandles.join(", ")}`
    : "";

  return `${where}

Aim to return at least 5 qualifying makers (up to ${TARGET_COUNT}). Finding 5+ requires searching MULTIPLE angles — don't stop after the first 2-3 hits. Vary cuisine, format, and neighborhood across your searches, e.g.: instagram bakery preorders, cookie/pastry drops, popup or farmers-market vendors, tamales / empanadas / dumplings, home & cottage-food bakers, dessert pop-ups — and search specific neighborhoods within the region by name. Keep trying fresh angles until you have at least 5 that fit, or you've genuinely exhausted the options. Only return fewer than 5 if the region truly lacks enough makers. Quality still matters: never pad with off-profile makers or large chains, and never include anyone already on Hotplate.${exclude}

Return a JSON array. Each element:
{
  "handle": "@theirhandle",
  "name": "Business name",
  "platform": "instagram" | "tiktok" | "other",
  "followers": <integer best estimate of follower count; use null ONLY if you truly can't tell, never guess 0>,
  "city": "City",
  "neighborhood": "Neighborhood or area",
  "metro_area": "Metro area",
  "what_they_sell": "Short description of products",
  "current_order_method": "How customers order today",
  "drop_cadence": "How often / when they sell",
  "notable_signals": ["short signal", "short signal"],
  "sample_post_caption": "A representative caption if you saw one (optional)",
  "website_or_linktree": "their link-in-bio / Linktree / website URL — ALWAYS include it when you can find one (we use it to verify they aren't already on Hotplate); else null"
}

Return ONLY the JSON array.`;
}

// Pull text out of however many text blocks the final message contains.
function collectText(content: Anthropic.ContentBlock[]): string {
  let out = "";
  for (const block of content) {
    if (block.type === "text") out += block.text + "\n";
  }
  return out;
}

// Parse the model's JSON array into validated Sellers. Tolerant of the usual
// LLM quirks (code fences, trailing commas, prose around the array). Anything
// without a real handle + name is dropped; ids/handles are normalized.
function parseSellers(rawText: string, excludeHandles: string[]): Seller[] {
  if (!rawText.trim()) return [];

  let text = rawText.replace(/```(?:json)?\n?/gm, "").trim();
  text = text.replace(/,(\s*[}\]])/g, "$1"); // tolerate trailing commas

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      data = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];

  const excluded = new Set(excludeHandles.map((h) => h.toLowerCase()));
  const seen = new Set<string>();
  const str = (v: unknown, fallback = "") =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;

  const sellers: Seller[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const name = str(r.name);
    const handleRaw = str(r.handle);
    if (!name || !handleRaw) continue;

    const handle = handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`;
    const key = handle.toLowerCase();
    if (excluded.has(key) || seen.has(key)) continue;
    seen.add(key);

    const id = key
      .replace(/^@/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!id) continue;

    const platform =
      r.platform === "tiktok" || r.platform === "other"
        ? r.platform
        : "instagram";
    // Unknown follower count -> null (never a fake 0). A real, active candidate
    // with literally 0 followers is implausible, so treat 0 as "couldn't tell".
    const followers =
      typeof r.followers === "number" &&
      Number.isFinite(r.followers) &&
      r.followers > 0
        ? Math.round(r.followers)
        : null;
    const signals = Array.isArray(r.notable_signals)
      ? r.notable_signals
          .filter((s): s is string => typeof s === "string" && !!s.trim())
          .map((s) => s.trim())
      : [];
    const city = str(r.city);

    sellers.push({
      id,
      handle,
      name,
      platform,
      followers,
      city,
      neighborhood: str(r.neighborhood, city),
      metro_area: str(r.metro_area, city),
      what_they_sell: str(r.what_they_sell),
      current_order_method: str(r.current_order_method),
      drop_cadence: str(r.drop_cadence),
      notable_signals: signals,
      sample_post_caption: str(r.sample_post_caption) || undefined,
      website_or_linktree: str(r.website_or_linktree) || undefined,
    });
  }
  return sellers;
}

// Belt-and-suspenders: drop a maker only when a field carries an actual Hotplate
// store URL (hotplate.com/... or hotplate.co/...) — the reliable "they already
// sell on Hotplate" signal. Deliberately NOT a bare "hotplate" substring: the
// model often tags good prospects with notes like "not yet on Hotplate", and a
// substring match wrongly drops them (it did — a real LA scan returned 2 makers
// and both were nuked). The prompt remains the primary exclusion mechanism.
const HOTPLATE_URL = /hotplate\.c(?:om|o)\b/i;
function looksOnHotplate(s: Seller): boolean {
  return [
    s.website_or_linktree,
    s.current_order_method,
    s.sample_post_caption,
    ...s.notable_signals,
  ].some((f) => !!f && HOTPLATE_URL.test(f));
}

// --- Enrichment + Hotplate verification (deterministic, fast, parallel) ------
// hotplate.com is a Next.js SSR app: a REAL store renders the store name into
// og:title + the maker's Instagram into the page data; an unknown slug renders
// the generic landing (og:title "Hotplate"). Instagram likewise renders the real
// follower count into og:description ("4,989 Followers, ..."). So we enrich (real
// followers) + verify (drop anyone already on Hotplate) over plain parallel HTTP —
// no LLM — fast enough to stay under Vercel's 300s limit while being reliable.
const HOTPLATE_LINK = /hotplate\.c(?:om|o)\/([a-z0-9_.-]+)/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Global HTTP concurrency gate for the enrich/verify pass. Without it, a dense
// region fires ~30+ parallel fetches at instagram.com / hotplate.com at once,
// which rate-limits us (429) → retries → the scan ballooned to ~288s (over
// Vercel's 300s cap). Capping concurrency keeps each request fast (first-try, no
// 429) and bounds the whole pass to a few predictable seconds.
function makeLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const exec = async (): Promise<T> => {
      active++;
      try {
        return await fn();
      } finally {
        active--;
        queue.shift()?.();
      }
    };
    if (active < max) return exec();
    return new Promise<void>((resolve) => queue.push(resolve)).then(exec);
  };
}
const httpLimit = makeLimiter(6);

// Title-case a resolved region for tagging ("new mexico" -> "New Mexico").
function titleCaseRegion(region: string): string {
  return region.replace(/\b\w/g, (c) => c.toUpperCase());
}

// "4,989" -> 4989, "11K" -> 11000, "1.2M" -> 1200000, "1.2B" -> 1200000000.
function parseFollowerCount(raw: string): number | null {
  const m = raw.trim().match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase() ?? ""] ?? 1;
  return Math.round(n * mult);
}

const IG_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Real follower count for an Instagram handle. Primary source is the
// web_profile_info JSON endpoint (small response, exact `edge_followed_by.count`,
// the same data the app's web client reads); the public profile's og:description
// ("X Followers, ...") is the fallback when JSON is unavailable. Returns null if
// both are blocked / not found (caller hides the stat). Concurrency-limited.
async function fetchInstagramFollowers(handle: string): Promise<number | null> {
  const h = handle.replace(/^@/, "").trim().toLowerCase();
  if (!h) return null;

  // Primary: lightweight JSON API used by instagram.com's own web client.
  try {
    const count = await httpLimit(async () => {
      const res = await fetch(
        `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
        {
          signal: AbortSignal.timeout(6000),
          headers: {
            "user-agent": IG_UA,
            "x-ig-app-id": "936619743392459",
            accept: "application/json",
          },
        }
      );
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const c = data?.data?.user?.edge_followed_by?.count;
      return typeof c === "number" && c > 0 ? Math.round(c) : null;
    });
    if (count != null) return count;
  } catch {
    // fall through to the HTML fallback
  }

  // Fallback: server-rendered og:description on the public profile page.
  try {
    return await httpLimit(async () => {
      const res = await fetch(`https://www.instagram.com/${h}/`, {
        signal: AbortSignal.timeout(6000),
        headers: { "user-agent": IG_UA, "accept-language": "en-US,en;q=0.9" },
      });
      if (!res.ok) return null;
      const html = await res.text();
      const desc = html.match(/property="og:description"\s+content="([^"]*)"/i)?.[1];
      const found = desc?.match(/([\d.,]+\s*[KMB]?)\s+Followers/i)?.[1];
      return found ? parseFollowerCount(found) : null;
    });
  } catch {
    return null;
  }
}

// Likely Hotplate store slugs for a maker (handle- and name-derived), plus the
// exact slug if their own bio link already points at a hotplate store.
function candidateSlugs(seller: Seller): {
  slugs: string[];
  fromLink: string | null;
} {
  const h = seller.handle.replace(/^@/, "").toLowerCase();
  const fromLink =
    seller.website_or_linktree?.match(HOTPLATE_LINK)?.[1]?.toLowerCase() ?? null;
  const slugs = [fromLink, h, h.replace(/[._]/g, ""), norm(seller.name)].filter(
    (s): s is string => !!s
  );
  return { slugs: [...new Set(slugs)], fromLink };
}

// Fetch a hotplate.com store page; { name, ig } if it's a real store, else null.
// Retries transient errors (429 / 5xx / timeout) so a blip can't fail-open into a
// leak; a genuine 404 or the generic landing returns null immediately.
type StoreResult = { name: string; ig: string | null } | null;
async function fetchHotplateStore(slug: string): Promise<StoreResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await httpLimit(async (): Promise<StoreResult | "retry"> => {
        const res = await fetch(`https://www.hotplate.com/${slug}`, {
          signal: AbortSignal.timeout(6000),
          headers: { "user-agent": "Mozilla/5.0 (ChefScout)" },
        });
        if (res.status === 429 || res.status >= 500) return "retry"; // transient
        if (!res.ok) return null; // 404 etc -> genuinely no store
        const html = await res.text();
        const og = html.match(/og:title"\s+content="([^"]*)"/i)?.[1]?.trim();
        if (!og || og === "Hotplate") return null; // generic landing = no store
        const ig =
          html.match(/instagram\.com\/([A-Za-z0-9_.]+)/i)?.[1]?.toLowerCase() ??
          null;
        return { name: og, ig };
      });
      if (out === "retry") continue; // transient -> retry once
      return out;
    } catch {
      // timeout / network -> loop retries once, then gives up
    }
  }
  return null;
}

// True if this maker already sells on Hotplate: a real hotplate.com/<slug> store
// confirmed as them via their own bio link, the store's IG handle, or its name.
async function isOnHotplate(s: Seller): Promise<boolean> {
  const handle = s.handle.replace(/^@/, "").toLowerCase();
  const nName = norm(s.name);
  const { slugs, fromLink } = candidateSlugs(s);
  const stores = await Promise.all(
    slugs.map((slug) => fetchHotplateStore(slug).then((store) => ({ slug, store })))
  );
  return stores.some(({ slug, store }) => {
    if (!store) return false;
    if (slug === fromLink) return true; // it's the link in their own bio
    if (store.ig && store.ig === handle) return true; // store IG == this maker
    const t = norm(store.name); // store name ~ maker name
    return !!t && !!nName && (t === nName || t.includes(nName) || nName.includes(t));
  });
}

// Per-maker parallel enrich (real IG followers) + Hotplate verification. Every
// maker and every probe runs concurrently, so wall-clock ~= the slowest maker.
async function enrichAndVerify(
  candidates: Seller[]
): Promise<{ seller: Seller; onHotplate: boolean }[]> {
  return Promise.all(
    candidates.map(async (s) => {
      const [igFollowers, onHotplate] = await Promise.all([
        s.platform === "instagram"
          ? fetchInstagramFollowers(s.handle)
          : Promise.resolve(null),
        isOnHotplate(s),
      ]);
      const followers = igFollowers ?? s.followers ?? null;
      return { seller: { ...s, followers }, onHotplate };
    })
  );
}

// Run the live web search and return validated, region-matched makers.
async function searchMakers(
  region: string | null,
  locationQuery: string | undefined,
  excludeHandles: string[]
): Promise<Seller[]> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserPrompt(region, excludeHandles) },
  ];

  // Web search runs a server-side loop; if it hits its cap mid-task the API
  // returns stop_reason "pause_turn" and we re-send to let it continue.
  let rawText = "";
  for (let i = 0; i < 6; i++) {
    // Stream instead of awaiting create(): a non-streaming web-search call holds
    // the connection open for minutes and trips the SDK request timeout
    // (APIConnectionTimeoutError) — the cause of flaky/empty scans. Streaming
    // keeps the connection alive until the search loop finishes.
    // Sonnet 4.6 + light adaptive thinking (needed for reliable structured output
    // and vetting — thinking-off returned nothing), low effort, searches capped.
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      // Generous output budget: across a long search loop the thinking + tool
      // blocks + the multi-maker JSON can exceed 16k and truncate (→ 0 parsed).
      // Streaming supports large outputs without HTTP timeouts.
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      // Medium (not low): low effort returns a conservative ~2-3 makers regardless
      // of search budget; medium explores more and commits to more candidates,
      // which is what gets us to 5+. Costs latency — acceptable per the goal.
      output_config: { effort: "medium" },
      system: SYSTEM,
      // Classic web search (no dynamic filtering). The _20260209 version runs
      // result-filtering CODE on every batch — ~23 server round-trips and ~5 min
      // per scan. _20250305 just reads results directly; max_uses actually caps
      // the search count. Hotplate verification is now a fast parallel HTTP check
      // (not an LLM pass), so discovery gets the budget; capped at 8 to keep the
      // total scan comfortably under Vercel's 300s limit.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages,
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }

    rawText = collectText(msg.content);
    break;
  }

  const parsed = parseSellers(rawText, excludeHandles).filter(
    (s) => !looksOnHotplate(s)
  );

  // Region tagging (Fix for state/region scans): instead of DROPPING makers whose
  // city-level fields don't literally contain the searched region — which nukes
  // state searches like "New Mexico" (a maker in Albuquerque has no "new mexico"
  // string) — tag the region onto metro_area so this filter AND the frontend
  // filter match. The model searched the exact region, so its makers belong there.
  const regional = region
    ? parsed.map((s) => {
        if (matchesLocation(s, region)) return s; // already matches — don't double-tag
        const label = titleCaseRegion(region);
        const metro = s.metro_area?.trim();
        return { ...s, metro_area: metro ? `${metro} (${label})` : label };
      })
    : parsed;

  // Enrich (real IG follower counts) + verify (drop anyone already on Hotplate),
  // parallel per maker. This is the reliable Hotplate gate.
  const verified = await enrichAndVerify(regional);
  const excluded = verified
    .filter((r) => r.onHotplate)
    .map((r) => r.seller.handle);
  if (excluded.length) {
    console.log("[scan] excluded (already on Hotplate):", excluded.join(", "));
  }
  return verified.filter((r) => !r.onHotplate).map((r) => r.seller);
}

export async function POST(req: NextRequest) {
  if (MISSING_KEY) {
    return Response.json(
      { found: [], error: MISSING_KEY_MESSAGE },
      { status: 401 }
    );
  }

  try {
    const {
      excludeHandles = [],
      locationQuery,
    }: { excludeHandles?: string[]; locationQuery?: string } = await req.json();

    // Resolve aliases ("nyc" -> "new york") so the search, cache, and UI agree.
    const region = locationQuery?.trim() ? resolveLocation(locationQuery) : null;

    // No region filter: the "re-scan the same region" cache doesn't apply — go live.
    if (!region) {
      const found = await searchMakers(null, undefined, excludeHandles);
      return Response.json({ found, cached: false });
    }

    // Per-region discovery cache (persistent via Upstash in prod, in-memory
    // locally — see lib/regionStore). `seen` is stored as an array (Redis
    // serializes JSON); rebuild a Set for O(1) dedupe.
    const entry = (await regionStore.get(region)) ?? { sellers: [], seen: [] };
    const seenSet = new Set(entry.seen);
    const clientHas = new Set(excludeHandles.map((h) => h.toLowerCase()));

    // Makers we already discovered for this region that aren't on the client's board.
    const unshown = entry.sellers.filter(
      (s) => !clientHas.has(s.handle.toLowerCase())
    );

    // Serve unshown cached makers — but RE-VERIFY against Hotplate first, never
    // trust the cache blindly (a stale entry, or a maker who joined Hotplate since
    // we cached them, must never leak). Verify-only (no IG re-enrich) keeps the
    // cache path fast. Prune any newly-on-Hotplate makers from the stored entry.
    if (unshown.length > 0) {
      const checked = await Promise.all(
        unshown.map((s) => isOnHotplate(s).then((on) => ({ s, on })))
      );
      const nowOn = new Set(
        checked.filter((c) => c.on).map((c) => c.s.handle.toLowerCase())
      );
      if (nowOn.size) {
        console.log(
          "[scan] excluded from cache (already on Hotplate):",
          [...nowOn].join(", ")
        );
        entry.sellers = entry.sellers.filter(
          (s) => !nowOn.has(s.handle.toLowerCase())
        );
        await regionStore.set(region, entry);
      }
      const clean = checked.filter((c) => !c.on).map((c) => c.s);
      if (clean.length > 0) {
        return Response.json({ found: clean, cached: true });
      }
      // else: cache held only on-Hotplate makers — fall through to a live search.
    }

    // Need fresh makers. Exclude everything the client already has AND everything
    // we've ever surfaced for this region, so a repeat scan never repeats a maker.
    const exclude = Array.from(new Set([...excludeHandles, ...seenSet]));
    const fresh = await searchMakers(region, locationQuery, exclude);

    // Remember the new ones for next time.
    for (const s of fresh) {
      const key = s.handle.toLowerCase();
      if (!seenSet.has(key)) {
        seenSet.add(key);
        entry.sellers.push(s);
      }
    }
    entry.seen = Array.from(seenSet);
    await regionStore.set(region, entry);

    const found = [...unshown, ...fresh].slice(0, TARGET_COUNT);
    return Response.json({ found, cached: false });
  } catch (err) {
    console.error("Scan error:", err);
    const { body, status } = toErrorResponse(err, "Scan failed. Please try again.");
    return Response.json({ found: [], ...body }, { status });
  }
}
