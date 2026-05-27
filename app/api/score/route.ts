import { anthropic } from "@/lib/anthropic";
import { Seller, ScoreResult } from "@/lib/types";
import { NextRequest } from "next/server";

const SYSTEM = `You are a Hotplate growth analyst. Hotplate is a drops-based ordering platform for independent food makers. Score the given SF food seller on switch-readiness and value. Return ONLY valid JSON matching the schema. No markdown, no extra text.`;

const RUBRIC = `Scoring rubric:
HIGH signals (+): preorder/drop language in bio, recurring weekly drop cadence, manual ordering method (Google Form, Venmo DM), sold-out posts, 1k-50k engaged followers, SF pickup model, curated menu focus, professional photography.
LOW signals (−): generic recipe content with no sales pathway, followers <500, existing brick-and-mortar at scale.
Tiers: Hobbyist 0-39, Emerging 40-59, High-Value 60-79, Established 80-100.`;

export async function POST(req: NextRequest) {
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

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
    const text = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const result: ScoreResult = JSON.parse(text);

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
    console.error("Score error:", err);
    return Response.json({ error: "Scoring failed" }, { status: 500 });
  }
}
