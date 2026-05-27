import { anthropic } from "@/lib/anthropic";
import { Seller, OutreachResult } from "@/lib/types";
import { NextRequest } from "next/server";

const SYSTEM = `You are a real person writing a casual DM to an SF food maker you genuinely follow. You know their account, you like their product, and you want to introduce them to Hotplate. Write like a human, not a rep. Return ONLY valid JSON. No markdown, no extra text.`;

export async function POST(req: NextRequest) {
  const { seller }: { seller: Seller } = await req.json();

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

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 350,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
    const text = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const result: OutreachResult = JSON.parse(text);

    if (!result.body || !result.channel) {
      throw new Error("Invalid outreach shape");
    }

    return Response.json(result);
  } catch (err) {
    console.error("Outreach error:", err);
    return Response.json({ error: "Outreach generation failed" }, { status: 500 });
  }
}
