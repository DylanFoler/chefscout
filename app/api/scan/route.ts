import { anthropic } from "@/lib/anthropic";
import { Seller } from "@/lib/types";
import { NextRequest } from "next/server";

const SYSTEM = `You are ChefScout, a discovery engine for Hotplate — a drop-based ordering platform for independent SF food makers. Identify real Instagram accounts from the SF food scene. Return ONLY valid JSON — no markdown, no extra text.`;

export async function POST(req: NextRequest) {
  const { excludeHandles }: { excludeHandles: string[] } = await req.json();

  const excluded = excludeHandles.join(", ");

  const userMsg = `Find 2 real SF food maker Instagram accounts that are strong Hotplate switch candidates.

Ideal prospect:
- 3,000 to 15,000 Instagram followers in San Francisco
- Takes orders via DM, Venmo, Google Form, or text list — manual, not a platform
- Runs drop-based or preorder pickups in an SF neighborhood, no permanent storefront (or just opened one)
- Sells out regularly — real demand constrained by manual ordering friction
- Active as of 2025-2026

Do not return any of these already-tracked handles: ${excluded}

Return a JSON array of exactly 2 sellers. Use real accounts from your knowledge of the SF food scene. Be specific.

[
  {
    "id": "handle_without_at_no_special_chars",
    "handle": "@handle",
    "name": "Brand name",
    "platform": "instagram",
    "followers": <number>,
    "city": "San Francisco",
    "what_they_sell": "<one descriptive sentence>",
    "current_order_method": "<how they currently take orders>",
    "drop_cadence": "<frequency and SF pickup location>",
    "notable_signals": ["<signal>", "<signal>", "<signal>"],
    "sample_post_caption": "<realistic caption in their voice>",
    "website_or_linktree": null
  }
]`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
    const text = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed: Seller[] = JSON.parse(text);

    if (!Array.isArray(parsed)) throw new Error("Expected array");

    const found = parsed.filter(
      (s) =>
        typeof s.id === "string" &&
        typeof s.handle === "string" &&
        typeof s.name === "string" &&
        typeof s.followers === "number" &&
        !excludeHandles.includes(s.handle)
    );

    return Response.json({ found });
  } catch (err) {
    console.error("Scan error:", err);
    return Response.json({ error: "Scan failed", found: [] }, { status: 500 });
  }
}
