import {
  anthropic,
  MISSING_KEY,
  MISSING_KEY_MESSAGE,
  toErrorResponse,
} from "@/lib/anthropic";
import { Seller, ScoreResult } from "@/lib/types";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a Hotplate growth analyst. Hotplate is a drops-based ordering platform for independent food makers. Score the given food seller on switch-readiness and value. Return ONLY valid JSON matching the schema. No markdown, no extra text.`;

const RUBRIC = `Scoring rubric:
HIGHEST-PRIORITY signals (weight these heaviest):
- Takes orders MANUALLY — especially by phone call or email; also Instagram DM, Google Form, text/Venmo waitlist. The more manual/scrappy the ordering, the better the fit. A maker already on a polished checkout/e-commerce platform is a WEAKER fit for switching.
- Sells SPECIFIC, REPEATABLE batch/box products — cupcake boxes, cookie boxes, batches of cinnamon rolls, bagel/bread drops, dozens of tamales/empanadas, mochi. These are the ideal Hotplate drop format.
OTHER HIGH signals (+): preorder/drop language in bio, recurring weekly drop cadence, sold-out posts, 1k-50k engaged followers, local pickup model, curated menu focus, professional photography.
LOW / negative signals (−): generic recipe content with no sales pathway, followers <500, existing brick-and-mortar at scale, AND a maker focused primarily on BESPOKE CUSTOM CAKES or fully made-to-order one-offs (weaker drops fit — de-prioritize vs batch/box makers, though not disqualifying).
Unknown followers: if the seller's "followers" field is null or absent, the follower count is UNKNOWN — do NOT apply the "followers <500" penalty and do NOT apply the "1k-50k followers" bonus; score the other signals normally and note in the breakdown that follower count was unavailable. NEVER describe a seller as having 0 followers — null means unknown; just omit follower mentions.
Tiers: Hobbyist 0-39, Emerging 40-59, High-Value 60-79, Established 80-100.`;

export async function POST(req: NextRequest) {
  if (MISSING_KEY) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 401 });
  }

  const seller: Seller = await req.json();

  const userMsg = `Seller: ${JSON.stringify(seller)}

${RUBRIC}

Return JSON:
{
  "score": <0-100>,
  "tier": <"Hobbyist"|"Emerging"|"High-Value"|"Established">,
  "switch_readiness": <0-100>,
  "signal_breakdown": [{"signal": string, "weight": <"low"|"medium"|"high">, "explanation": string}],
  "recommended_action": <one sentence>
}`;

  let raw = "";
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });

    const block = msg.content[0];
    raw = block && block.type === "text" ? block.text : "";

    let text = raw.replace(/```(?:json)?\n?/gm, "").trim();
    text = text.replace(/,(\s*[}\]])/g, "$1"); // tolerate trailing commas (common LLM quirk)
    if (!text) throw new Error("Empty response from Claude");

    let result: ScoreResult;
    try {
      result = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON object in response");
      result = JSON.parse(m[0]);
    }

    if (
      typeof result.score !== "number" ||
      typeof result.switch_readiness !== "number" ||
      !result.tier ||
      !Array.isArray(result.signal_breakdown) ||
      !result.recommended_action
    ) {
      throw new Error("Invalid score shape");
    }

    // clamp both scores to 0-100
    result.score = Math.min(100, Math.max(0, Math.round(result.score)));
    result.switch_readiness = Math.min(100, Math.max(0, Math.round(result.switch_readiness)));

    return Response.json(result);
  } catch (err) {
    console.error("Score error:", err, "Raw response:", raw);
    const { body, status } = toErrorResponse(err, "Scoring failed");
    return Response.json(body, { status });
  }
}
