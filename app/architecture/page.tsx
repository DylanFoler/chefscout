import { readFileSync } from "fs";
import { join } from "path";
import Link from "next/link";
import ArchitecturePanel from "@/components/ArchitecturePanel";

function getSources() {
  const file = join(process.cwd(), "data", "discovery_sources.json");
  return JSON.parse(readFileSync(file, "utf-8"));
}

export default function ArchitecturePage() {
  const sources = getSources();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-5 py-12">
        {/* Nav */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <Link
              href="/"
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              ← Back to leaderboard
            </Link>
          </div>
        </div>

        {/* Header */}
        <div className="mb-10">
          <div className="inline-block text-xs font-semibold px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 mb-4">
            Production Vision
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-3">
            Discovery Architecture
          </h1>
          <p className="text-zinc-400 leading-relaxed max-w-xl">
            In production, ChefScout continuously scans these sources to surface
            new high-value SF food makers. For this prototype, sellers are
            populated from a manually curated seed file.
          </p>
        </div>

        {/* Sources */}
        <ArchitecturePanel sources={sources} />

        {/* Next phase panel */}
        <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-6">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
            Next Phase
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-zinc-200 mb-1">
                Activation & Onboarding Automation
              </h3>
              <p className="text-sm text-zinc-500">
                High-scoring sellers flow into an automated outreach sequence.
                Accepted invites trigger a guided Hotplate onboarding with first
                drop pre-configured.
              </p>
            </div>
            <div className="border-t border-zinc-800" />
            <div>
              <h3 className="font-semibold text-zinc-200 mb-1">
                Funnel Instrumentation
              </h3>
              <p className="text-sm text-zinc-500">
                Track outreach-to-activation rate by tier, score threshold, and
                outreach channel. Feed conversion data back into the scoring
                rubric to improve signal weights.
              </p>
            </div>
            <div className="border-t border-zinc-800" />
            <div>
              <h3 className="font-semibold text-zinc-200 mb-1">
                Continuous Scoring Pipeline
              </h3>
              <p className="text-sm text-zinc-500">
                Re-score discovered sellers weekly. Sellers who gain followers,
                increase drop cadence, or accumulate sold-out posts rise in the
                leaderboard automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
