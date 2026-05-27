"use client";

import { useState, useCallback } from "react";
import { Seller, ScoreResult } from "@/lib/types";
import SellerCard from "./SellerCard";

type SellerState = {
  score: ScoreResult | null;
  loading: boolean;
  error: boolean;
};

async function pLimit<T>(
  fns: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(fns.length);
  let i = 0;

  async function worker() {
    while (i < fns.length) {
      const idx = i++;
      results[idx] = await fns[idx]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

type Props = { sellers: Seller[]; preloadedScores?: Record<string, ScoreResult> };

export default function Leaderboard({ sellers, preloadedScores = {} }: Props) {
  const [states, setStates] = useState<Record<string, SellerState>>(() =>
    Object.fromEntries(
      sellers.map((s) => [
        s.id,
        { score: preloadedScores[s.id] ?? null, loading: false, error: false },
      ])
    )
  );
  const hasPreloaded = sellers.some((s) => preloadedScores[s.id]);
  const [scoring, setScoring] = useState(false);
  const [sorted, setSorted] = useState(hasPreloaded);

  function setState(id: string, patch: Partial<SellerState>) {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const scoreOne = useCallback(
    async (seller: Seller) => {
      setState(seller.id, { loading: true, error: false });
      try {
        const res = await fetch("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(seller),
        });
        if (!res.ok) throw new Error("Failed");
        const score: ScoreResult = await res.json();
        setState(seller.id, { score, loading: false });
      } catch {
        setState(seller.id, { loading: false, error: true });
      }
    },
    []
  );

  async function scoreAll() {
    setScoring(true);
    setSorted(false);
    const tasks = sellers.map((s) => () => scoreOne(s));
    await pLimit(tasks, 5);
    setSorted(true);
    setScoring(false);
  }

  const displayed = sorted
    ? [...sellers].sort((a, b) => {
        const sa = states[a.id]?.score?.score ?? -1;
        const sb = states[b.id]?.score?.score ?? -1;
        return sb - sa;
      })
    : sellers;

  const anyScored = sellers.some((s) => states[s.id]?.score);

  return (
    <div className="space-y-6">
      {/* Score all button */}
      <div className="flex items-center gap-4">
        <button
          onClick={scoreAll}
          disabled={scoring}
          className="px-6 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {scoring ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-zinc-400 border-t-zinc-800 animate-spin" />
              Scoring…
            </>
          ) : anyScored ? (
            "Re-score all sellers"
          ) : (
            "Score all sellers"
          )}
        </button>
        {anyScored && !scoring && (
          <span className="text-xs text-zinc-500">
            Sorted by score — click any card to expand
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {displayed.map((seller) => (
          <SellerCard
            key={seller.id}
            seller={seller}
            score={states[seller.id]?.score ?? null}
            loading={states[seller.id]?.loading ?? false}
            error={states[seller.id]?.error ?? false}
            onRetry={() => scoreOne(seller)}
          />
        ))}
      </div>
    </div>
  );
}
