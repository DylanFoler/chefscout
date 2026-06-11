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

  const channel =
    seller.platform === "instagram"
      ? "instagram_dm"
      : seller.platform === "tiktok"
      ? "tiktok_dm"
      : "email";
  const isDM = channel === "instagram_dm" || channel === "tiktok_dm";

  // Generic, no-handle regional social proof — keep the metro in its proper case
  // ("a lot of Bay Area food folks use").
  const metro = (seller.metro_area || seller.city || "").trim();
  const folks = metro ? `${metro} food folks` : "food folks";

  // We're based in the Bay, so we only offer to physically swing by a maker's
  // popup when they're in the Bay Area. Everyone else gets the call-only ask.
  const geo = `${seller.metro_area} ${seller.city} ${seller.neighborhood}`;
  const isBay =
    /bay area|san francisco|oakland|berkeley|san jose|peninsula|south bay|east bay|marin|daly city|alameda|\bsf\b/i.test(
      geo
    );

  // Only reference catering / event-order chaos if the maker actually does it.
  const cateringHay = `${seller.what_they_sell} ${seller.current_order_method} ${
    seller.drop_cadence
  } ${seller.notable_signals.join(" ")} ${seller.sample_post_caption ?? ""}`;
  const doesCatering =
    /cater|\bevents?\b|private event|wholesale|parties|corporate|book(?:ing)? us/i.test(
      cateringHay
    );

  const SYSTEM = `You write short, warm outreach DMs on behalf of Hotplate to independent food makers. Hotplate is the tool pop-up food makers use to run orders and pickups without all the scheduling back-and-forth. Your goal is a friendly, personal opener that earns a reply and gently offers a quick chat (and, when appropriate, a visit), never a sales pitch. Sound like a real, down-to-earth person who actually eats at food popups. Return ONLY valid JSON. No markdown, no extra text.`;

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

Match the tone, structure, capitalization, and warmth of this GOLD-STANDARD example exactly:
"Hey! I'm with Hotplate, the tool a lot of Bay Area food folks use to run orders and pickups without all the scheduling back-and-forth. I just came across your mochi donuts and they look unreal, and it seems like they move pretty fast too! I'd love to help take some of the catering and event-order chaos off your plate so people aren't sliding into your DMs at all hours. Would you be up for hopping on a quick call to see if any of it might be useful? Or honestly, I'd love to just swing by your next pop-up and say hi if that's easier. :)"

Rules:
- Channel: ${channel}. ${
    isDM
      ? "No subject, no formal greeting line, no sign-off. 3-5 sentences, reads like a real DM."
      : "Short subject + 3-5 warm, casual sentences."
  }
- Use normal sentence case with proper capitalization, like the example: capitalize the start of sentences, "I", and proper nouns (Hotplate, ${metro || "the metro"}, DMs). Warm and polished, NOT all-lowercase.
- Open with: "Hey! I'm with Hotplate, the tool a lot of ${folks} use to run orders and pickups without all the scheduling back-and-forth." Do NOT introduce yourself by name.
- ONE specific, genuine compliment on THEIR actual product (name it), plus a light nod to traction (moving fast / selling out / growing). Real, not generic flattery.
- A help line framing Hotplate as taking friction off their plate so people aren't sliding into their DMs at all hours. ${
    doesCatering
      ? "This maker DOES catering / events, so you MAY reference taking the catering and event-order chaos off their plate."
      : "This maker does NOT appear to do catering or events, so do NOT mention catering or events. Focus on their real friction: juggling DM orders, chasing Venmo, and keeping up when drops sell out."
  }
- Close with a soft, low-pressure ask. ${
    isBay
      ? 'Offer BOTH options: "Would you be up for hopping on a quick call to see if any of it might be useful? Or honestly, I\'d love to just swing by your next pop-up and say hi if that\'s easier. :)"'
      : "Offer ONLY a quick call — we're based in the Bay Area and can't realistically swing by their location, so do NOT offer to visit or stop by in person. End warmly, e.g. \"Would you be up for hopping on a quick call to see if any of it might be useful? :)\""
  }
- No name. No @handles or other accounts. No calendar link. No em dashes. No buzzwords. Don't use "I wanted to reach out" or anything that reads like a sales template.

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
