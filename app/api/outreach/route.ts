import {
  anthropic,
  MISSING_KEY,
  MISSING_KEY_MESSAGE,
  toErrorResponse,
} from "@/lib/anthropic";
import { Seller, OutreachResult } from "@/lib/types";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (MISSING_KEY) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 401 });
  }

  const { seller }: { seller: Seller } = await req.json();

  const SYSTEM = `You are a real person writing a casual DM to a ${seller.city} food maker you genuinely follow. You know their account, you like their product, and you want to introduce them to Hotplate. Write like a human, not a rep. Return ONLY valid JSON. No markdown, no extra text.`;

  const channel =
    seller.platform === "instagram"
      ? "instagram_dm"
      : seller.platform === "tiktok"
      ? "tiktok_dm"
      : "email";

  const isDM = channel === "instagram_dm" || channel === "tiktok_dm";

  const userMsg = `Draft outreach for:
Name: ${seller.name}
Sells: ${seller.what_they_sell}
Current ordering: ${seller.current_order_method}
Drop cadence: ${seller.drop_cadence}
Platform: ${seller.platform} (${seller.followers.toLocaleString()} followers)
Neighborhood: ${seller.neighborhood}
Metro area: ${seller.metro_area}
${seller.sample_post_caption ? `Recent post: "${seller.sample_post_caption}"` : ""}
${seller.notable_signals.length ? `Notable: ${seller.notable_signals.join(", ")}` : ""}

Rules:
- Channel: ${channel}
- ${isDM ? "No subject, no formal greeting, no sign-off. Conversational, 2-4 sentences max. Short like a real DM." : "Include subject, 4-6 sentences, professional but warm."}
- Open with a specific detail from their account that shows you actually follow them (the product, the drop, the caption vibe)
- Name the friction they feel right now (managing DMs, people missing the story drop, chasing Venmo)
- Mention Hotplate in one natural sentence, not a pitch sentence
- Low-pressure close, like you're offering to help not sell something
- No em dashes. No exclamation points unless it fits the brand voice. No filler phrases like "I wanted to reach out" or "I came across your page."
- Sound like a text from someone who eats at food popups, not a sales email

Return JSON:
{
  "channel": "${channel}",
  ${!isDM ? '"subject": <string>,' : ""}
  "body": <string>,
  "rationale": <one sentence on why this angle>
}`;

  let raw = "";
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });

    const block = msg.content[0];
    raw = block && block.type === "text" ? block.text : "";

    let text = raw.replace(/```(?:json)?\n?/gm, "").trim();
    text = text.replace(/,(\s*[}\]])/g, "$1"); // tolerate trailing commas (common LLM quirk)
    if (!text) throw new Error("Empty response from Claude");

    let result: OutreachResult;
    try {
      result = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON object in response");
      result = JSON.parse(m[0]);
    }

    if (!result.body || !result.channel) {
      throw new Error("Invalid outreach shape");
    }

    return Response.json(result);
  } catch (err) {
    console.error("Outreach error:", err, "Raw response:", raw);
    const { body, status } = toErrorResponse(err, "Outreach generation failed");
    return Response.json(body, { status });
  }
}
