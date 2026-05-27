"use client";

import { useState } from "react";
import { Seller, ScoreResult, OutreachResult } from "@/lib/types";

const TIER_STYLES: Record<string, string> = {
  Hobbyist: "bg-zinc-700 text-zinc-300",
  Emerging: "bg-blue-900 text-blue-300",
  "High-Value": "bg-emerald-900 text-emerald-300",
  Established: "bg-purple-900 text-purple-300",
};

const PLATFORM_STYLES: Record<string, string> = {
  instagram: "bg-pink-900 text-pink-300",
  tiktok: "bg-zinc-800 text-zinc-300",
  other: "bg-zinc-700 text-zinc-400",
};

const WEIGHT_COLOR: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-yellow-400",
  low: "text-zinc-500",
};

type Props = {
  seller: Seller;
  score: ScoreResult | null;
  loading: boolean;
  error: boolean;
  isNew?: boolean;
  onRetry: () => void;
};

export default function SellerCard({ seller, score, loading, error, isNew, onRetry }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [outreach, setOutreach] = useState<OutreachResult | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generateOutreach() {
    setOutreachLoading(true);
    setOutreachError(false);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller }),
      });
      if (!res.ok) throw new Error("Failed");
      const data: OutreachResult = await res.json();
      setOutreach(data);
    } catch {
      setOutreachError(true);
    } finally {
      setOutreachLoading(false);
    }
  }

  async function copyOutreach() {
    if (!outreach) return;
    await navigator.clipboard.writeText(outreach.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`rounded-xl border bg-zinc-900 overflow-hidden ${isNew ? "border-emerald-700" : "border-zinc-800"}`}>
      {/* Header row */}
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-zinc-800/60 transition-colors"
        onClick={() => score && setExpanded((e) => !e)}
        disabled={loading || error}
      >
        {/* Score circle */}
        <div className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center border-2 border-zinc-700 bg-zinc-800">
          {loading ? (
            <div className="w-5 h-5 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin" />
          ) : error ? (
            <span className="text-red-400 text-xs">!</span>
          ) : score ? (
            <span className="text-xl font-bold text-white">{score.score}</span>
          ) : (
            <span className="text-zinc-600 text-lg">—</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{seller.name}</span>
            <span className="text-zinc-400 text-sm">{seller.handle}</span>
            {isNew && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-900 text-emerald-300 border border-emerald-700">
                New
              </span>
            )}
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLATFORM_STYLES[seller.platform]}`}
            >
              {seller.platform}
            </span>
            {score && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TIER_STYLES[score.tier]}`}
              >
                {score.tier}
              </span>
            )}
          </div>
          <div className="text-zinc-400 text-sm mt-0.5 truncate">{seller.what_they_sell}</div>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            <span>{seller.followers.toLocaleString()} followers</span>
            <span>·</span>
            <span>{seller.drop_cadence}</span>
            {score && (
              <>
                <span>·</span>
                <span className="text-zinc-400">
                  Switch readiness:{" "}
                  <span className="text-white font-medium">{score.switch_readiness}</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Retry / expand caret */}
        <div className="shrink-0 flex items-center gap-2">
          {error && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="text-xs px-3 py-1 rounded-full bg-red-900/60 text-red-300 hover:bg-red-800 transition-colors"
            >
              Retry
            </button>
          )}
          {score && (
            <span className="text-zinc-600 text-sm">{expanded ? "▲" : "▼"}</span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && score && (
        <div className="border-t border-zinc-800 px-5 py-4 space-y-5">
          {/* Signal breakdown */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Signal Breakdown
            </h3>
            <div className="space-y-2">
              {score.signal_breakdown.map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span
                    className={`text-xs font-bold uppercase mt-0.5 w-12 flex-shrink-0 ${WEIGHT_COLOR[s.weight]}`}
                  >
                    {s.weight}
                  </span>
                  <div>
                    <div className="text-sm text-zinc-200 font-medium">{s.signal}</div>
                    <div className="text-xs text-zinc-500">{s.explanation}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended action */}
          <div className="bg-zinc-800/60 rounded-lg px-4 py-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
              Recommended Action
            </div>
            <div className="text-sm text-zinc-200">{score.recommended_action}</div>
          </div>

          {/* Outreach section */}
          <div>
            {!outreach && !outreachLoading && (
              <button
                onClick={generateOutreach}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
              >
                Generate outreach
              </button>
            )}
            {outreachLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <div className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin" />
                Writing outreach draft…
              </div>
            )}
            {outreachError && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-red-400">Outreach failed.</span>
                <button
                  onClick={generateOutreach}
                  className="text-xs px-3 py-1 rounded-full bg-red-900/60 text-red-300 hover:bg-red-800 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            {outreach && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-zinc-500 uppercase tracking-wider">
                    {outreach.channel.replace("_", " ")}
                    {outreach.subject && `: ${outreach.subject}`}
                  </div>
                  <button
                    onClick={copyOutreach}
                    className="text-xs px-3 py-1 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="bg-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                  {outreach.body}
                </div>
                <div className="text-xs text-zinc-600 italic">{outreach.rationale}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
