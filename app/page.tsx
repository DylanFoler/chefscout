import { readFileSync } from "fs";
import { join } from "path";
import Link from "next/link";
import { Seller, ScoreResult } from "@/lib/types";
import Leaderboard from "@/components/Leaderboard";

function getSellers(): Seller[] {
  const file = join(process.cwd(), "data", "sellers.json");
  return JSON.parse(readFileSync(file, "utf-8"));
}

function getPreloadedScores(): Record<string, ScoreResult> {
  try {
    const file = join(process.cwd(), "data", "scores.json");
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

export default function Home() {
  const sellers = getSellers();
  const preloadedScores = getPreloadedScores();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-5 py-12">
        {/* Nav */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ChefScout</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Find and score high-value SF chefs ready to switch to Hotplate.
            </p>
          </div>
          <Link
            href="/architecture"
            className="text-sm text-zinc-400 hover:text-white transition-colors border border-zinc-700 hover:border-zinc-500 px-4 py-1.5 rounded-full"
          >
            Architecture →
          </Link>
        </div>

        {sellers.length < 5 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-8 text-center">
            <div className="text-2xl mb-3">📋</div>
            <h2 className="font-semibold text-white mb-2">No sellers yet</h2>
            <p className="text-zinc-400 text-sm max-w-sm mx-auto">
              Add at least 5 sellers to{" "}
              <code className="bg-zinc-800 px-1 rounded text-zinc-300">
                data/sellers.json
              </code>{" "}
              to see the leaderboard. Use the Instagram hashtag strategy in the
              build spec to find SF food makers.
            </p>
          </div>
        ) : (
          <Leaderboard sellers={sellers} preloadedScores={preloadedScores} />
        )}
      </div>
    </div>
  );
}
