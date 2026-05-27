import { anthropic } from "@/lib/anthropic";
import { Seller, OutreachResult } from "@/lib/types";
import { NextRequest } from "next/server";

const SYSTEM = `You are a Hotplate growth rep drafting outreach to SF food makers. Hotplate lets them set a drop, customers pay upfront, no Venmo chasing. Return ONLY valid JSON — no markdown, no extra text.`;

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
- ${isDM ? "No subject, no formal sign-off, 3-5 sentences max" : "Include subject, 4-6 sentences"}
- Lead with THEIR specific pain/moment (clunky order method, selling out), not Hotplate features
- Reference their actual product by name
- Mention Hotplate in one sentence after the hook
- End with low-friction CTA (quick chat, setup link, no pressure)
- Sound like a human who looked at their account, not a template

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
