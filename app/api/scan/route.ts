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

// --- Hotplate verification (deterministic, fast, parallel) -------------------
// hotplate.com is a Next.js SSR app: a REAL store slug server-renders the store
// name into og:title plus the maker's Instagram into the page data, while an
// unknown slug renders the generic landing (og:title "Hotplate"). So we detect a
// maker's Hotplate store over plain HTTP — no JS, no LLM — and confirm it's THEM
// by matching the store's Instagram handle or its name. This replaces a slow LLM
// web-search pass (~minutes) with a few parallel fetches (~seconds), which keeps
// the scan under Vercel's 300s function limit while catching the makers the
// discovery prompt misses.
const HOTPLATE_LINK = /hotplate\.c(?:om|o)\/([a-z0-9_.-]+)/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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

// Fetch a hotplate.com store page; return { name, ig } if it's a real store, else
// null (generic landing, non-200, or network error -> "couldn't confirm").
async function fetchHotplateStore(
  slug: string
): Promise<{ name: string; ig: string | null } | null> {
  try {
    const res = await fetch(`https://www.hotplate.com/${slug}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (ChefScout)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const og = html.match(/og:title"\s+content="([^"]*)"/i)?.[1]?.trim();
    if (!og || og === "Hotplate") return null; // generic landing = no store here
    const ig =
      html.match(/instagram\.com\/([A-Za-z0-9_.]+)/i)?.[1]?.toLowerCase() ?? null;
    return { name: og, ig };
  } catch {
    return null;
  }
}

// Returns the lowercased handles of candidates confirmed to be on Hotplate.
// Every candidate and every slug probe runs in parallel (~a few seconds total).
async function flagHotplateUsers(candidates: Seller[]): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (candidates.length === 0) return flagged;

  await Promise.all(
    candidates.map(async (s) => {
      const handle = s.handle.replace(/^@/, "").toLowerCase();
      const nName = norm(s.name);
      const { slugs, fromLink } = candidateSlugs(s);
      const stores = await Promise.all(
        slugs.map((slug) =>
          fetchHotplateStore(slug).then((store) => ({ slug, store }))
        )
      );
      const onHotplate = stores.some(({ slug, store }) => {
        if (!store) return false;
        if (slug === fromLink) return true; // it's the link in their own bio
        if (store.ig && store.ig === handle) return true; // store IG == this maker
        const t = norm(store.name); // store name ~ maker name
        return (
          !!t && !!nName && (t === nName || t.includes(nName) || nName.includes(t))
        );
      });
      if (onHotplate) flagged.add(s.handle.toLowerCase());
    })
  );
  return flagged;
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
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
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
  // Never surface a candidate the active location filter would immediately hide.
  const regional = locationQuery
    ? parsed.filter((s) => matchesLocation(s, locationQuery))
    : parsed;

  // Reliable Hotplate gate: actively verify each remaining candidate isn't already
  // on Hotplate (searches + fetches their links for a hotplate.com/<slug> store).
  // The discovery prompt + URL filter miss some; this catches the discoverable ones.
  const onHotplate = await flagHotplateUsers(regional);
  if (onHotplate.size) {
    console.log(
      "[scan] excluded (already on Hotplate):",
      [...onHotplate].join(", ")
    );
  }
  return regional.filter((s) => !onHotplate.has(s.handle.toLowerCase()));
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

    // Any unshown cached makers for this region → serve them instantly, no web
    // call. After a reload the board is empty, so re-scanning a region you've
    // already scanned returns immediately. Once they're on the board they're
    // excluded, and the scan falls through to a fresh live search for new ones.
    if (unshown.length > 0) {
      return Response.json({ found: unshown, cached: true });
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
