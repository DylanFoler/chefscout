"use client";

import { useState } from "react";
import { Seller, ScoreResult, OutreachResult } from "@/lib/types";

const TIER_STYLES: Record<string, string> = {
  Hobbyist: "bg-sand text-ink",
  Emerging: "bg-lilac text-ink",
  "High-Value": "bg-coral/15 text-coral",
  Established: "bg-ink text-cream",
};

const PLATFORM_STYLES: Record<string, string> = {
  instagram: "bg-lilac text-ink",
  tiktok: "bg-sand text-ink",
  other: "bg-sand text-muted",
};

const WEIGHT_COLOR: Record<string, string> = {
  high: "text-coral",
  medium: "text-ink",
  low: "text-muted",
};

type Props = {
  seller: Seller;
  score: ScoreResult | null;
  loading: boolean;
  error: boolean;
  refreshFailed?: boolean;
  isNew?: boolean;
  onRetry: () => void;
};

export default function SellerCard({ seller, score, loading, error, refreshFailed, isNew, onRetry }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [outreach, setOutreach] = useState<OutreachResult | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tierStyle = score ? TIER_STYLES[score.tier] ?? "bg-sand text-ink" : "";

  async function generateOutreach() {
    setOutreachLoading(true);
    setOutreachError(null);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seller }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Outreach failed.");
      }
      const data: OutreachResult = await res.json();
      setOutreach(data);
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : "Outreach failed.");
    } finally {
      setOutreachLoading(false);
    }
  }

  async function copyOutreach() {
    if (!outreach) return;
    try {
      await navigator.clipboard.writeText(outreach.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${isNew ? "border-coral" : "border-sand"}`}>
      {/* Header row — div not button so the Retry button inside is valid HTML */}
      <div
        className={`w-full text-left px-5 py-4 flex items-center gap-4 transition-colors ${
          score ? "hover:bg-cream/70 cursor-pointer" : "cursor-default"
        }`}
        onClick={() => score && !loading && !error && setExpanded((e) => !e)}
      >
        {/* Score circle */}
        <div className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center border-2 border-sand bg-cream">
          {loading ? (
            <div className="w-5 h-5 rounded-full border-2 border-sand border-t-coral animate-spin" />
          ) : error ? (
            <span className="text-red-500 text-xs">!</span>
          ) : score ? (
            <span className="text-xl font-bold text-ink">{score.score}</span>
          ) : (
            <span className="text-muted text-lg">·</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink">{seller.name}</span>
            <span className="text-muted text-sm">{seller.handle}</span>
            {isNew && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-coral/15 text-coral border border-coral/40">
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
                className={`text-xs px-2 py-0.5 rounded-full font-semibold ${tierStyle}`}
              >
                {score.tier}
              </span>
            )}
            {score && refreshFailed && (
              <span
                title="Last refresh failed — showing the previous score"
                className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-800 border border-amber-300"
              >
                couldn&apos;t refresh
              </span>
            )}
          </div>
          <div className="text-muted text-sm mt-0.5 truncate">{seller.what_they_sell}</div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted">
            {seller.followers != null && (
              <>
                <span>{seller.followers.toLocaleString()} followers</span>
                <span>·</span>
              </>
            )}
            <span>{seller.neighborhood}</span>
            <span>·</span>
            <span>{seller.drop_cadence}</span>
            {score && (
              <>
                <span>·</span>
                <span className="text-muted">
                  Switch readiness:{" "}
                  <span className="text-ink font-medium">{score.switch_readiness}</span>
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
              className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
            >
              Retry
            </button>
          )}
          {score && (
            <span className="text-muted text-sm">{expanded ? "▲" : "▼"}</span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && score && (
        <div className="border-t border-sand px-5 py-4 space-y-5">
          {/* Signal breakdown */}
          <div>
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
              Signal Breakdown
            </h3>
            <div className="space-y-2">
              {score.signal_breakdown.length === 0 && (
                <div className="text-sm text-muted italic">No signals returned.</div>
              )}
              {score.signal_breakdown.map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span
                    className={`text-xs font-bold uppercase mt-0.5 w-12 flex-shrink-0 ${WEIGHT_COLOR[s.weight] ?? "text-muted"}`}
                  >
                    {s.weight}
                  </span>
                  <div>
                    <div className="text-sm text-ink font-medium">{s.signal}</div>
                    <div className="text-xs text-muted">{s.explanation}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended action */}
          <div className="bg-cream rounded-lg px-4 py-3">
            <div className="text-xs text-muted uppercase tracking-wider mb-1">
              Recommended Action
            </div>
            <div className="text-sm text-ink">{score.recommended_action}</div>
          </div>

          {/* Outreach section */}
          <div>
            {!outreach && !outreachLoading && (
              <button
                onClick={generateOutreach}
                className="px-4 py-2 rounded-lg bg-coral hover:bg-coral-700 text-white text-sm font-medium transition-colors"
              >
                Generate outreach
              </button>
            )}
            {outreachLoading && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <div className="w-4 h-4 rounded-full border-2 border-sand border-t-coral animate-spin" />
                Writing outreach draft…
              </div>
            )}
            {outreachError && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-red-500">{outreachError}</span>
                <button
                  onClick={generateOutreach}
                  className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
            {outreach && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted uppercase tracking-wider">
                    {outreach.channel.replace("_", " ")}
                    {outreach.subject && `: ${outreach.subject}`}
                  </div>
                  <button
                    onClick={copyOutreach}
                    className="text-xs px-3 py-1 rounded-full bg-white border border-sand text-ink hover:border-coral transition-colors"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="bg-cream rounded-lg px-4 py-3 text-sm text-ink whitespace-pre-wrap leading-relaxed">
                  {outreach.body}
                </div>
                <div className="text-xs text-muted italic">{outreach.rationale}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
