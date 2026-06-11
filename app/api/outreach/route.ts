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

  // Generic, no-handle regional social proof ("a lot of bay area food folks use").
  const region = (seller.metro_area || seller.city || "").trim().toLowerCase();
  const folks = region ? `${region} food folks` : "food folks";

  const SYSTEM = `You write short, casual outreach DMs on behalf of Hotplate to independent food makers. Hotplate is the tool pop-up food makers use to run orders and pickups without all the DM back-and-forth. Your goal is a warm, personal opener that earns a reply and gently offers a quick chat or a visit, never a sales pitch. Sound like a real, down-to-earth person who actually eats at food popups. Return ONLY valid JSON. No markdown, no extra text.`;

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

Match the tone, structure, and warmth of this example EXACTLY — it is the target voice:
"hey! i'm with hotplate, the tool a lot of bay area food folks use to run orders and pickups without all the dm back-and-forth. just came across your mochi donuts and they look unreal. seems like they move pretty fast too! figured we might be able to take some of the catering and event-order chaos off your plate, so people aren't sliding into your dms at all hours. would you be up for hopping on a quick call to see if any of it'd be useful? or honestly, i'd love to just swing by your next pop-up and say hi if that's easier :)"

Rules:
- Channel: ${channel}. ${
    isDM
      ? "No subject, no greeting, no sign-off. 3-5 short sentences, reads like a real DM."
      : "Short subject + 3-5 warm, casual sentences."
  }
- Open with "hey! i'm with hotplate, the tool a lot of ${folks} use to run orders and pickups without all the dm back-and-forth" (or a very close, natural variant). Do NOT introduce yourself by name.
- Then ONE specific, genuine compliment on THEIR actual product (name the real product), plus a light nod to traction (selling out / moving fast / growing). Real, not generic flattery.
- Then a help line that names their real friction concretely and a little vividly (people sliding into their DMs at all hours, chasing Venmo, the catering / event-order chaos), framed as taking it off their plate. Not a pitch.
- Close with a soft, low-pressure DUAL ask: up for a quick call to see if any of it'd be useful, OR you'd love to just swing by their next pop-up / drop to say hi if that's easier. End with ":)" or one fitting emoji.
- lowercase-casual, warm, a little enthusiastic. No name. No other accounts or @handles. No calendar link. No em dashes. No buzzwords. Nothing that reads like a sales template ("I wanted to reach out", "I came across your page").

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
