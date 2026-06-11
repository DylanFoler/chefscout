import Link from "next/link";
import Leaderboard from "@/components/Leaderboard";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-5 py-12">
        {/* Nav */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ChefScout</h1>
            <p className="text-zinc-400 text-sm mt-1">
              Find and score high-value food makers ready to switch to Hotplate.
            </p>
          </div>
          <Link
            href="/architecture"
            className="text-sm text-zinc-400 hover:text-white transition-colors border border-zinc-700 hover:border-zinc-500 px-4 py-1.5 rounded-full"
          >
            Architecture →
          </Link>
        </div>

        {/* Sellers are discovered live via scan — the board starts empty. */}
        <Leaderboard sellers={[]} />
      </div>
    </div>
  );
}
