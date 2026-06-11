"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Seller, ScoreResult } from "@/lib/types";
import { matchesLocation } from "@/lib/location";
import SellerCard from "./SellerCard";

type SellerState = {
  score: ScoreResult | null;
  loading: boolean;
  error: boolean;
  refreshFailed?: boolean;
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
  "Searching the web for food makers...",
  "Scanning Instagram drop accounts...",
  "Checking popup & preorder vendors...",
  "Cross-referencing Hotplate...",
  "Vetting candidates...",
];

function buildScanPhases(loc: string): string[] {
  if (!loc.trim()) return SCAN_PHASES;
  const label = loc.trim();
  return [
    `Searching the web for ${label} food makers...`,
    `Scanning ${label} Instagram drop accounts...`,
    `Checking ${label} popup & preorder vendors...`,
    `Cross-referencing Hotplate...`,
    `Vetting candidates...`,
  ];
}

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

  // Tracks seller ids with an in-flight score request, so Retry / auto-score / re-score
  // can't double-fire the same request and double the API spend.
  const inFlight = useRef<Set<string>>(new Set());

  const hasPreloaded = sellers.some((s) => preloadedScores[s.id]);
  const [scoring, setScoring] = useState(false);
  const [sorted, setSorted] = useState(hasPreloaded);
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState("");
  const [scanProgress, setScanProgress] = useState(0);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const phaseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [locationQuery, setLocationQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [listCopied, setListCopied] = useState(false);

  const scoreOne = useCallback(async (seller: Seller) => {
    if (inFlight.current.has(seller.id)) return;
    inFlight.current.add(seller.id);
    setStates((prev) => ({
      ...prev,
      [seller.id]: { ...prev[seller.id], loading: true, error: false, refreshFailed: false },
    }));
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seller),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 401 && data?.error) setAuthError(data.error);
        throw new Error(data?.error || "score api error");
      }
      const score: ScoreResult = await res.json();
      setStates((prev) => ({
        ...prev,
        [seller.id]: { ...prev[seller.id], score, loading: false, error: false, refreshFailed: false },
      }));
    } catch {
      // Distinguish a hard failure (no score to show) from a failed refresh
      // (a prior score exists). Never silently present a stale score as fresh.
      setStates((prev) => {
        const hadScore = prev[seller.id]?.score != null;
        return {
          ...prev,
          [seller.id]: {
            ...prev[seller.id],
            loading: false,
            error: !hadScore,
            refreshFailed: hadScore,
          },
        };
      });
    } finally {
      inFlight.current.delete(seller.id);
    }
  }, []);

  async function scoreAll() {
    setScoring(true);
    setSorted(false);
    setAuthError(null);
    const tasks = allSellersRef.current.map((s) => () => scoreOne(s));
    await pLimit(tasks, 5);
    setSorted(true);
    setScoring(false);
  }

  async function runScan() {
    setScanning(true);
    setScanResult(null);
    setScanProgress(0);

    // A scan is one backend request with no mid-flight progress, so animate a
    // smooth ease-out bar against elapsed time: it climbs toward ~92% and slows
    // as it goes (never stuck, never falsely "done"), then snaps to 100% when
    // the response lands. Tuned for a typical ~50s live scan; instant cache hits
    // return before the bar moves and jump straight to 100%.
    const startedAt = Date.now();
    const phases = buildScanPhases(locationQuery);
    let phaseIdx = 0;
    setScanPhase(phases[0]);
    phaseRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setScanProgress(Math.min(92, 92 * (1 - Math.exp(-elapsed / 20000))));
      phaseIdx = (phaseIdx + 1) % phases.length;
      setScanPhase(phases[phaseIdx]);
    }, 400);

    try {
      const currentHandles = allSellersRef.current.map((s) => s.handle);

      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          excludeHandles: currentHandles,
          locationQuery: locationQuery || undefined,
        }),
      });

      const {
        found,
        error,
        cached,
      }: { found: Seller[]; error?: string; cached?: boolean } =
        await res.json();

      if (error) {
        // A real failure (missing/expired key, rate limit, search error) — show it
        // rather than mislabeling it as "no candidates".
        setScanResult(error);
        return;
      }

      if (!found || found.length === 0) {
        const region = locationQuery.trim();
        setScanResult(
          region
            ? `No new candidates found in ${region}`
            : "No new candidates found"
        );
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

      // Scan now only returns candidates matching the active region (see scan route),
      // so every found seller is visible under the current filter. `cached` means
      // the region cache served them instantly without a fresh web search.
      setScanResult(
        `Found ${found.length} new candidate${found.length !== 1 ? "s" : ""}${
          cached ? " · instant" : ""
        }`
      );

      found.forEach((s) => scoreOne(s));
    } catch {
      setScanResult("Scan failed. Try again");
    } finally {
      if (phaseRef.current) {
        clearInterval(phaseRef.current);
        phaseRef.current = null;
      }
      // Complete the bar, then hold the full state briefly so 100% is visible.
      setScanProgress(100);
      setScanPhase("");
      window.setTimeout(() => {
        setScanning(false);
        setScanProgress(0);
      }, 350);
    }
  }

  useEffect(() => {
    return () => {
      if (phaseRef.current) clearInterval(phaseRef.current);
    };
  }, []);

  const sorted_sellers = sorted
    ? [...allSellers].sort((a, b) => {
        const sa = states[a.id]?.score?.score ?? -1;
        const sb = states[b.id]?.score?.score ?? -1;
        return sb - sa;
      })
    : allSellers;

  const displayed = sorted_sellers.filter((s) => {
    const kw = searchQuery.toLowerCase();
    const matchKeyword =
      !kw ||
      s.name.toLowerCase().includes(kw) ||
      s.handle.toLowerCase().includes(kw) ||
      s.what_they_sell.toLowerCase().includes(kw);
    return matchKeyword && matchesLocation(s, locationQuery);
  });

  const anyScored = allSellers.some((s) => states[s.id]?.score);
  const newOnesScoring = allSellers.some(
    (s) => states[s.id]?.isNew && states[s.id]?.loading
  );
  const filtersActive = !!(locationQuery || searchQuery);

  async function copyList() {
    const lines = displayed
      .map((s) => {
        const score = states[s.id]?.score?.score;
        const scoreStr = score != null ? `Score: ${score}` : "unscored";
        return `${s.name} (${s.handle}) — ${scoreStr} — ${s.neighborhood}, ${s.city}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      setListCopied(true);
      setTimeout(() => setListCopied(false), 2000);
    } catch (err) {
      console.error("Copy list failed:", err);
    }
  }

  return (
    <div className="space-y-4">
      {/* Auth / config error banner */}
      {authError && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-700 bg-amber-950/60 px-4 py-3">
          <div className="text-sm text-amber-200">
            <span className="font-semibold">Couldn&apos;t reach Claude.</span>{" "}
            {authError}
          </div>
          <button
            onClick={() => setAuthError(null)}
            className="shrink-0 text-amber-400 hover:text-amber-200 text-base leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex flex-wrap items-center gap-3">
        {allSellers.length > 0 && (
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
        )}

        <button
          onClick={runScan}
          disabled={scanning || scoring}
          className="px-5 py-2 rounded-full bg-zinc-800 text-white text-sm font-semibold hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 min-w-45"
        >
          {scanning ? (
            <>
              <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin shrink-0" />
              <span className="text-zinc-400 text-xs font-normal">
                Scanning...
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

        {anyScored && !scoring && !scanResult && !filtersActive && (
          <span className="text-xs text-zinc-500">
            Sorted by score — click any card to expand
          </span>
        )}
      </div>

      {/* Scan progress bar */}
      {scanning && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 truncate pr-2">{scanPhase}</span>
            <span className="text-zinc-500 tabular-nums shrink-0">
              {Math.round(scanProgress)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Location filter */}
        <div className="relative flex-1">
          <input
            type="text"
            placeholder='Location — "Bay Area", "Mission District", "New York"…'
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
            className="w-full px-4 py-2 pr-8 rounded-full bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          {locationQuery && (
            <button
              onClick={() => setLocationQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-base leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Keyword filter */}
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search by name or product…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 pr-8 rounded-full bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-base leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Copy filtered list */}
        {filtersActive && displayed.length > 0 && (
          <button
            onClick={copyList}
            className="shrink-0 px-4 py-2 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm transition-colors"
          >
            {listCopied ? "Copied!" : "Copy list"}
          </button>
        )}
      </div>

      {/* Filter result count */}
      {filtersActive && displayed.length > 0 && (
        <div className="text-xs text-zinc-500">
          {displayed.length} of {allSellers.length} sellers
        </div>
      )}

      {/* No sellers yet — the board is populated live via scan */}
      {allSellers.length === 0 && !scanning && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-10 text-center">
          <div className="text-2xl mb-3">🔍</div>
          <h2 className="font-semibold text-white mb-1">
            No companies scanned yet
          </h2>
          <p className="text-zinc-400 text-sm">
            Enter a region above and hit{" "}
            <span className="text-zinc-200">Scan for new sellers</span> to find
            food makers.
          </p>
        </div>
      )}

      {/* Empty state — sellers exist but filtered out */}
      {filtersActive && displayed.length === 0 && allSellers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-8 text-center text-zinc-400 text-sm">
          No sellers match your filters.{" "}
          <button
            onClick={() => {
              setSearchQuery("");
              setLocationQuery("");
            }}
            className="text-zinc-200 underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Seller list */}
      <div className="space-y-3">
        {displayed.map((seller) => (
          <SellerCard
            key={seller.id}
            seller={seller}
            score={states[seller.id]?.score ?? null}
            loading={states[seller.id]?.loading ?? false}
            error={states[seller.id]?.error ?? false}
            refreshFailed={states[seller.id]?.refreshFailed ?? false}
            isNew={states[seller.id]?.isNew ?? false}
            onRetry={() => scoreOne(seller)}
          />
        ))}
      </div>
    </div>
  );
}
