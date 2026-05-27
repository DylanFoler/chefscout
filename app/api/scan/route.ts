import { anthropic } from "@/lib/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import { Seller } from "@/lib/types";
import { NextRequest } from "next/server";

function normalizeFollowers(val: unknown): number {
  if (typeof val === "number") return Math.round(val);
  if (typeof val === "string") return parseInt(val.replace(/[^0-9]/g, ""), 10) || 0;
  return 0;
}

export async function POST(req: NextRequest) {
  const { excludeHandles }: { excludeHandles: string[] } = await req.json();
  const excluded = excludeHandles.join(", ");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [
        {
          type: "web_search_20250305" as const,
          name: "web_search",
        },
      ],
      system: `You are ChefScout, a discovery engine for Hotplate. Search the web for real SF food popup Instagram accounts. After searching, output ONLY a valid JSON array of sellers — no explanation, no markdown.`,
      messages: [
        {
          role: "user",
          content: `Search the web for 2 real SF food popup or cottage baker Instagram accounts with these traits: DM or manual ordering (Venmo, Google Form, text list), drop-based SF neighborhood pickups, no permanent storefront, roughly 3,000-15,000 followers.

Do NOT include any of these handles: ${excluded}

After searching, output ONLY this JSON array (no other text):
[
  {
    "id": "handle_without_at",
    "handle": "@handle",
    "name": "Brand name",
    "platform": "instagram",
    "followers": 7500,
    "city": "San Francisco",
    "what_they_sell": "what they sell in one sentence",
    "current_order_method": "how they currently take orders",
    "drop_cadence": "how often they drop and SF pickup location",
    "notable_signals": ["signal one", "signal two"],
    "sample_post_caption": "a real or realistic caption",
    "website_or_linktree": null
  }
]`,
        },
      ],
    });

    // Collect all text blocks from the response
    const allText = (msg.content as Anthropic.ContentBlock[])
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

    // Strip markdown fences and extract the JSON array
    const stripped = allText
      .replace(/^```(?:json)?\s*/im, "")
      .replace(/\s*```\s*$/im, "")
      .trim();

    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      console.error("Scan text output:", allText.slice(0, 400));
      throw new Error("No JSON array in scan response");
    }

    const parsed: Seller[] = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error("Expected array");

    const found: Seller[] = parsed
      .filter(
        (s) =>
          typeof s.id === "string" &&
          typeof s.handle === "string" &&
          typeof s.name === "string" &&
          !excludeHandles.includes(s.handle)
      )
      .map((s) => ({
        ...s,
        followers: normalizeFollowers(s.followers),
        platform: "instagram" as const,
        notable_signals: Array.isArray(s.notable_signals)
          ? s.notable_signals
          : typeof s.notable_signals === "string"
          ? [s.notable_signals]
          : [],
      }));

    return Response.json({ found });
  } catch (err) {
    console.error("Scan error:", err);
    return Response.json({ error: "Scan failed", found: [] }, { status: 500 });
  }
}
