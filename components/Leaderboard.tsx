"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Seller, ScoreResult } from "@/lib/types";
import SellerCard from "./SellerCard";

type SellerState = {
  score: ScoreResult | null;
  loading: boolean;
  error: boolean;
  isNew?: boolean;
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

const SCAN_PHASES = [
  "Scanning #sfpopup...",
  "Checking #sfdrops...",
  "Reading Off the Grid vendor list...",
  "Scanning #sfbaker...",
  "Cross-referencing Hotplate...",
  "Analyzing new candidates...",
];

type Props = { sellers: Seller[]; preloadedScores?: Record<string, ScoreResult> };

export default function Leaderboard({ sellers, preloadedScores = {} }: Props) {
  const [allSellers, setAllSellers] = useState<Seller[]>(sellers);
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
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const phaseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function patchState(id: string, patch: Partial<SellerState>) {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const scoreOne = useCallback(async (seller: Seller) => {
    patchState(seller.id, { loading: true, error: false });
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seller),
      });
      if (!res.ok) throw new Error("Failed");
      const score: ScoreResult = await res.json();
      patchState(seller.id, { score, loading: false });
    } catch {
      patchState(seller.id, { loading: false, error: true });
    }
  }, []);

  async function scoreAll() {
    setScoring(true);
    setSorted(false);
    const tasks = allSellers.map((s) => () => scoreOne(s));
    await pLimit(tasks, 5);
    setSorted(true);
    setScoring(false);
  }

  async function runScan() {
    setScanning(true);
    setScanResult(null);
    let phaseIdx = 0;
    setScanPhase(SCAN_PHASES[0]);

    phaseRef.current = setInterval(() => {
      phaseIdx = (phaseIdx + 1) % SCAN_PHASES.length;
      setScanPhase(SCAN_PHASES[phaseIdx]);
    }, 380);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludeIds: allSellers.map((s) => s.id) }),
      });
      const { found }: { found: Seller[] } = await res.json();

      if (found.length > 0) {
        setAllSellers((prev) => [...prev, ...found]);
        setStates((prev) => ({
          ...prev,
          ...Object.fromEntries(
            found.map((s) => [
              s.id,
              { score: null, loading: false, error: false, isNew: true },
            ])
          ),
        }));
        setScanResult(
          `Found ${found.length} new candidate${found.length > 1 ? "s" : ""}`
        );
      } else {
        setScanResult("No new candidates found");
      }
    } catch {
      setScanResult("Scan failed — try again");
    } finally {
      if (phaseRef.current) clearInterval(phaseRef.current);
      setScanning(false);
      setScanPhase("");
    }
  }

  useEffect(() => {
    return () => {
      if (phaseRef.current) clearInterval(phaseRef.current);
    };
  }, []);

  const displayed = sorted
    ? [...allSellers].sort((a, b) => {
        const sa = states[a.id]?.score?.score ?? -1;
        const sb = states[b.id]?.score?.score ?? -1;
        return sb - sa;
      })
    : allSellers;

  const anyScored = allSellers.some((s) => states[s.id]?.score);
  const allDiscoveredScored =
    allSellers.every((s) => !states[s.id]?.isNew || states[s.id]?.score);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={scoreAll}
          disabled={scoring || scanning}
          className="px-6 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {scoring ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-zinc-400 border-t-zinc-800 animate-spin" />
              Scoring...
            </>
          ) : anyScored ? (
            "Re-score all"
          ) : (
            "Score all sellers"
          )}
        </button>

        <button
          onClick={runScan}
          disabled={scanning || scoring}
          className="px-6 py-2.5 rounded-full bg-zinc-800 text-white text-sm font-semibold hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {scanning ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin" />
              <span className="text-zinc-400 text-xs font-normal tabular-nums">
                {scanPhase}
              </span>
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4 text-zinc-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              Scan for new sellers
            </>
          )}
        </button>

        {scanResult && !scanning && (
          <span
            className={`text-xs px-3 py-1 rounded-full border ${
              scanResult.startsWith("Found")
                ? "text-emerald-400 border-emerald-800 bg-emerald-950"
                : "text-zinc-500 border-zinc-800"
            }`}
          >
            {scanResult}
            {scanResult.startsWith("Found") && !allDiscoveredScored && (
              <span className="ml-1 opacity-60">— score them to rank</span>
            )}
          </span>
        )}

        {anyScored && !scoring && !scanResult && (
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
            isNew={states[seller.id]?.isNew ?? false}
            onRetry={() => scoreOne(seller)}
          />
        ))}
      </div>
    </div>
  );
}
