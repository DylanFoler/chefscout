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

// How many candidates to surface per scan. Each one gets auto-scored client-side,
// so keep this modest to bound the follow-up scoring spend — and so the model
// isn't forced to keep digging for an obscure Nth maker, which inflates latency.
const TARGET_COUNT = 3;

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
- EXCLUDE anyone already selling on Hotplate — if their bio, posts, or link tree show a hotplate.com link, a "hotplate.com/<name>" store, or "order on Hotplate", skip them. We want PROSPECTS not yet on the platform, never existing Hotplate sellers.
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

Find up to ${TARGET_COUNT} makers that fit the profile.${exclude}

Return a JSON array. Each element:
{
  "handle": "@theirhandle",
  "name": "Business name",
  "platform": "instagram" | "tiktok" | "other",
  "followers": <integer best estimate from what you saw>,
  "city": "City",
  "neighborhood": "Neighborhood or area",
  "metro_area": "Metro area",
  "what_they_sell": "Short description of products",
  "current_order_method": "How customers order today",
  "drop_cadence": "How often / when they sell",
  "notable_signals": ["short signal", "short signal"],
  "sample_post_caption": "A representative caption if you saw one (optional)",
  "website_or_linktree": "url if any, else null"
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
    const followers =
      typeof r.followers === "number" && Number.isFinite(r.followers)
        ? Math.max(0, Math.round(r.followers))
        : 0;
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
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      // Classic web search (no dynamic filtering). The _20260209 version runs
      // result-filtering CODE on every batch — ~23 server round-trips and ~5 min
      // per scan. _20250305 just reads results directly; max_uses actually caps
      // the search count, cutting latency dramatically.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
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

  const parsed = parseSellers(rawText, excludeHandles);

  // Never surface a candidate the active location filter would immediately hide.
  return locationQuery
    ? parsed.filter((s) => matchesLocation(s, locationQuery))
    : parsed;
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
