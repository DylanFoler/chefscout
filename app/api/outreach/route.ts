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

  const {
    seller,
    senderName: rawSender,
  }: { seller: Seller; senderName?: string } = await req.json();

  // Sender name is a fill-in the team swaps in before sending — never hardcode
  // a specific person. Defaults to a clearly-bracketed placeholder.
  const senderName =
    typeof rawSender === "string" && rawSender.trim()
      ? rawSender.trim()
      : "[your name]";

  const channel =
    seller.platform === "instagram"
      ? "instagram_dm"
      : seller.platform === "tiktok"
      ? "tiktok_dm"
      : "email";
  const isDM = channel === "instagram_dm" || channel === "tiktok_dm";

  const SYSTEM =`You write short, warm outreach DMs on behalf of Hotplate's partnerships team to independent food makers you genuinely admire. Hotplate is a preordering / drops platform for pop-up food makers. Your goal is a friendly, personal opener that earns a reply and gently leads toward a quick chat — never a sales pitch. Sound like a real, down-to-earth person who actually eats at food popups, the way a thoughtful founder or partnerships lead texts. Return ONLY valid JSON. No markdown, no extra text.`;

  const userMsg = `Draft an OPENER outreach message for:
Name: ${seller.name}
Sells: ${seller.what_they_sell}
Current ordering: ${seller.current_order_method}
Drop cadence: ${seller.drop_cadence}
Platform: ${seller.platform} (${seller.followers.toLocaleString()} followers)
Neighborhood: ${seller.neighborhood}
Metro area: ${seller.metro_area}
${seller.sample_post_caption ? `Recent post: "${seller.sample_post_caption}"` : ""}
${seller.notable_signals.length ? `Notable: ${seller.notable_signals.join(", ")}` : ""}

Write it in this voice — these are the patterns that actually book chats:
- Channel: ${channel}. ${
    isDM
      ? "No subject, no formal greeting, no sign-off. 2-4 short sentences, reads like a real DM."
      : "Short subject + 3-5 warm, casual sentences."
  }
- Open casually and introduce yourself by name: "hi! this is ${senderName}, i run partnerships at hotplate" (use "${senderName}" exactly as written, even if it's a bracketed placeholder).
- One plain line on what Hotplate is (a preordering / drops platform for pop-up food makers). Not a pitch.
- ONE specific, genuine compliment tied to THIS maker — their product, a recent post, selling out, their growth, their popup. Real, not generic flattery.
- Do NOT name or cite any other maker/business accounts, and don't add a "we work with..." social-proof line. Keep it entirely about THEM.
- Frame Hotplate as making their life easier (less DM juggling, no missed story drops, no chasing Venmo) — help, not a sale.
- Close with a soft, low-pressure ask to connect: a quick chat or call, or offer to swing by their next popup or during prep — flexible and easygoing. Do NOT paste a calendar link in this first message.
- Warm and a little enthusiastic: a couple of exclamation points and ONE emoji are good when they fit (match the emoji to their food when natural). Lowercase-casual is fine. Never stiff or corporate.
- No em dashes. No buzzwords. Never "I wanted to reach out", "I came across your page", or anything that reads like a sales template.

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
      max_tokens: 700,
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

    // Hard guarantee: the model still slips em/en dashes in despite the prompt
    // rule, and outreach should carry none. Swap them for a casual comma.
    const stripDashes = (t: string) =>
      t.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
    result.body = stripDashes(result.body);
    if (result.subject) result.subject = stripDashes(result.subject);

    return Response.json(result);
  } catch (err) {
    console.error("Outreach error:", err, "Raw response:", raw);
    const { body, status } = toErrorResponse(err, "Outreach generation failed");
    return Response.json(body, { status });
  }
}
