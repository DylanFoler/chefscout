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

        {/* Continuous pipeline */}
        <div className="mt-10 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-6">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            How to replicate this at scale
          </div>
          <p className="text-sm text-zinc-400 mb-6">
            ChefScout is designed as a closed loop. Each step feeds the next,
            so the leaderboard stays fresh and the scoring rubric improves over
            time without manual intervention.
          </p>

          {/* Pipeline steps */}
          <div className="space-y-0">
            {[
              {
                step: "1",
                label: "Discover",
                color: "text-blue-400",
                detail:
                  "A weekly cron job scans Instagram hashtags (#sfpopup, #sfdrops, #sfbaker), location tags, Off the Grid vendor lists, and the CA cottage food registry. Any account not already in the database gets queued for scoring.",
              },
              {
                step: "2",
                label: "Score",
                color: "text-emerald-400",
                detail:
                  "Claude Haiku scores each new discovery in batch — same rubric as this prototype, running against the /api/score endpoint. Existing sellers are re-scored weekly so that accounts that gain followers or add drop cadence move up automatically.",
              },
              {
                step: "3",
                label: "Rank & filter",
                color: "text-yellow-400",
                detail:
                  "The leaderboard surfaces the top 20 actionable targets: score above 60, no permanent storefront, SF pickup, not already on Hotplate. Sellers that graduate to a lease or join Hotplate are archived, not deleted.",
              },
              {
                step: "4",
                label: "Outreach",
                color: "text-orange-400",
                detail:
                  "Claude Sonnet drafts a personalized DM for each top-ranked seller. The draft leads with their specific pain — DM chaos, story ordering, Square fees — before naming Hotplate. A human reviews and sends.",
              },
              {
                step: "5",
                label: "Activate",
                color: "text-pink-400",
                detail:
                  "Accepted invites trigger a guided onboarding with the first drop pre-configured. The seller's score, tier, and signals travel with them so onboarding is tailored to their setup.",
              },
              {
                step: "6",
                label: "Feed back",
                color: "text-purple-400",
                detail:
                  "Conversion outcomes (accepted, ignored, bounced) are tagged by score tier and outreach channel. That signal feeds back into the scoring weights — high-converting signals get heavier, low-converting ones get lighter.",
              },
            ].map((s, i, arr) => (
              <div key={s.step} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-7 h-7 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center text-xs font-bold ${s.color} shrink-0`}
                  >
                    {s.step}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="w-px flex-1 bg-zinc-800 my-1" />
                  )}
                </div>
                <div className={`pb-6 ${i === arr.length - 1 ? "pb-0" : ""}`}>
                  <div className={`font-semibold text-sm mb-1 ${s.color}`}>
                    {s.label}
                  </div>
                  <p className="text-sm text-zinc-500 leading-relaxed">
                    {s.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Next phase panel */}
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-6">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
            Why the loop compounds
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-zinc-200 mb-1">
                The rubric gets smarter with every activation
              </h3>
              <p className="text-sm text-zinc-500">
                Right now the scoring weights are based on first-principles
                reasoning about what makes a seller likely to switch. Once
                Hotplate has 50+ activations with tracked signals, the weights
                can be tuned against real conversion data. A seller scoring 65
                today might score 80 under a rubric trained on what actually
                converted.
              </p>
            </div>
            <div className="border-t border-zinc-800" />
            <div>
              <h3 className="font-semibold text-zinc-200 mb-1">
                Catch popups before they sign a lease
              </h3>
              <p className="text-sm text-zinc-500">
                The best Hotplate prospects are 3-6 months away from opening a
                storefront: big enough to feel the DM chaos, not yet locked into
                a lease. Weekly re-scoring surfaces these accounts at the right
                moment. The window is short — a weekly cadence is the difference
                between pitching a popup and pitching a brick-and-mortar.
              </p>
            </div>
            <div className="border-t border-zinc-800" />
            <div>
              <h3 className="font-semibold text-zinc-200 mb-1">
                SF is a proof of concept, not the ceiling
              </h3>
              <p className="text-sm text-zinc-500">
                The hashtag scan and scoring pipeline work in any city. Once the
                SF leaderboard is dialed in, adding NYC, LA, or Chicago is a
                config change — not a rebuild.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
