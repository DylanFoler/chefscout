import Link from "next/link";
import Leaderboard from "@/components/Leaderboard";

export default function Home() {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <div className="max-w-3xl mx-auto px-5 py-12">
        {/* Nav */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ChefScout</h1>
            <p className="text-muted text-sm mt-1">
              Find and score high-value food makers ready to switch to Hotplate.
            </p>
          </div>
          <Link
            href="/architecture"
            className="text-sm text-muted hover:text-coral transition-colors border border-sand hover:border-coral px-4 py-1.5 rounded-full"
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
