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
  "Scanning #sfbaker...",
  "Reading Off the Grid list...",
  "Cross-referencing Hotplate...",
  "Analyzing candidates...",
];

type Props = {
  sellers: Seller[];
  preloadedScores?: Record<string, ScoreResult>;
};

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

  // Ref so scoreAll and runScan always read the latest sellers without stale closure
  const allSellersRef = useRef(allSellers);
  useEffect(() => {
    allSellersRef.current = allSellers;
  }, [allSellers]);

  const hasPreloaded = sellers.some((s) => preloadedScores[s.id]);
  const [scoring, setScoring] = useState(false);
  const [sorted, setSorted] = useState(hasPreloaded);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const phaseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scoreOne = useCallback(async (seller: Seller) => {
    setStates((prev) => ({
      ...prev,
      [seller.id]: { ...prev[seller.id], loading: true, error: false },
    }));
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seller),
      });
      if (!res.ok) throw new Error("score api error");
      const score: ScoreResult = await res.json();
      setStates((prev) => ({
        ...prev,
        [seller.id]: { ...prev[seller.id], score, loading: false },
      }));
    } catch {
      // If there is already a score, silently restore it — no exclamation mark
      setStates((prev) => ({
        ...prev,
        [seller.id]: {
          ...prev[seller.id],
          loading: false,
          error: prev[seller.id]?.score == null,
        },
      }));
    }
  }, []);

  async function scoreAll() {
    setScoring(true);
    setSorted(false);
    const tasks = allSellersRef.current.map((s) => () => scoreOne(s));
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
    }, 420);

    try {
      const currentHandles = allSellersRef.current.map((s) => s.handle);

      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludeHandles: currentHandles }),
      });

      const { found, error }: { found: Seller[]; error?: string } = await res.json();

      if (error || !found || found.length === 0) {
        setScanResult("No new candidates found");
        return;
      }

      setAllSellers((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        return [...prev, ...found.filter((s) => !existingIds.has(s.id))];
      });

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
        `Found ${found.length} new candidate${found.length !== 1 ? "s" : ""}`
      );

      found.forEach((s) => scoreOne(s));
    } catch {
      setScanResult("Scan failed. Try again");
    } finally {
      if (phaseRef.current) {
        clearInterval(phaseRef.current);
        phaseRef.current = null;
      }
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
        // Freshly-discovered sellers pin to the top so they're visible the
        // moment they're found — otherwise their null score sorts them to the
        // bottom of the scored list and they look like they never appeared.
        const na = states[a.id]?.isNew ? 1 : 0;
        const nb = states[b.id]?.isNew ? 1 : 0;
        if (na !== nb) return nb - na;
        const sa = states[a.id]?.score?.score ?? -1;
        const sb = states[b.id]?.score?.score ?? -1;
        return sb - sa;
      })
    : allSellers;

  const anyScored = allSellers.some((s) => states[s.id]?.score);
  const newOnesScoring = allSellers.some(
    (s) => states[s.id]?.isNew && states[s.id]?.loading
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={scoreAll}
          disabled={scoring || scanning}
          className="px-5 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {scoring ? (
            <>
              <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-400 border-t-zinc-800 animate-spin" />
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
          className="px-5 py-2 rounded-full bg-zinc-800 text-white text-sm font-semibold hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 min-w-45"
        >
          {scanning ? (
            <>
              <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin shrink-0" />
              <span className="text-zinc-400 text-xs font-normal truncate">
                {scanPhase}
              </span>
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5 text-zinc-400 shrink-0"
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
            {newOnesScoring && (
              <span className="ml-1.5 opacity-60">scoring...</span>
            )}
          </span>
        )}

        {anyScored && !scoring && !scanResult && (
          <span className="text-xs text-zinc-500">
            Sorted by score — click any card to expand
          </span>
        )}
      </div>

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
