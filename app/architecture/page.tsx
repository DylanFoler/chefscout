import Link from "next/link";

const PIPELINE = [
  {
    step: "1",
    label: "Discover",
    detail:
      "When you scan a region, ChefScout runs a live web search through Claude (Sonnet) — not a static list. It fires TWO passes in parallel under a shared time budget: a fast “broad” pass that reliably returns the clearest local makers (so a scan is never empty), plus a “diverse” pass that pushes past the obvious bakeries into other cuisines and formats. Their results are merged and de-duplicated.",
  },
  {
    step: "2",
    label: "Verify & enrich",
    detail:
      "Every candidate is checked deterministically over plain HTTP — no LLM, just a few fast parallel fetches. We drop anyone already on Hotplate (probing their hotplate.com store by handle/name and confirming via the store’s linked Instagram), pull each maker’s real Instagram follower count and business-address city, and drop makers whose real city is in a different state than the region you searched. The survivors are tagged to your region.",
  },
  {
    step: "3",
    label: "Score",
    detail:
      "Claude Haiku rates each verified maker on switch-readiness against a rubric: recurring drop cadence, manual ordering (phone/email/DM), specific repeatable batch or box products, sell-out demand, and follower range. It returns a 0–100 score, a tier, a signal-by-signal breakdown, and a recommended next action.",
  },
  {
    step: "4",
    label: "Outreach",
    detail:
      "On demand, Claude Sonnet drafts a short, personal DM in our growth lead’s voice — it opens with the maker’s specific pain (drop-day DM chaos, manual waitlists) before naming Hotplate, makes a soft dual ask, and offers to swing by a Bay-Area popup when the maker is local. A human reviews and sends.",
  },
  {
    step: "5",
    label: "Cache & dedupe",
    detail:
      "Each region’s results are cached (Upstash Redis) so re-scanning is instant and never repeats a maker you’ve already seen. The cache is never trusted blindly: on every hit we re-verify Hotplate status and re-apply the region check, so a maker who has since joined Hotplate — or one cached before a fix — self-heals out of the list.",
  },
];

const GUARANTEES = [
  {
    title: "Never an existing Hotplate seller",
    body: "The discovery prompt excludes them, and a deterministic hotplate.com store probe (with suffix-aware slug matching, retried on transient errors) catches the ones the prompt misses — on both the live and cached paths.",
  },
  {
    title: "Never out of region",
    body: "A maker’s real Instagram business-address state is checked against the searched region; a famous out-of-town name-drop is dropped, while suburbs (same state) and genuinely multi-state metros (NYC, DMV…) are kept.",
  },
  {
    title: "Real numbers or nothing",
    body: "Follower counts come straight from Instagram. When a count can’t be verified it’s simply hidden — the tool never shows a fake “0 followers” or an “unknown” placeholder, and scoring treats an unknown count neutrally.",
  },
  {
    title: "Fast enough to stay live",
    body: "The whole scan — dual web-search passes plus all verification — is bounded to finish under the platform’s 300s function limit. Concurrency on the verification fetches is capped so a dense region can’t rate-limit itself into a timeout.",
  },
];

export default function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <div className="max-w-3xl mx-auto px-5 py-12">
        {/* Nav */}
        <div className="flex items-center justify-between mb-12">
          <Link
            href="/"
            className="text-sm text-muted hover:text-coral transition-colors"
          >
            ← Back to leaderboard
          </Link>
        </div>

        {/* Header */}
        <div className="mb-10">
          <div className="inline-block text-xs font-semibold px-3 py-1 rounded-full bg-lilac text-ink border border-sand mb-4">
            How it works
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-3">
            Inside a ChefScout scan
          </h1>
          <p className="text-muted leading-relaxed max-w-xl">
            Type a region, hit scan, and ChefScout finds real, currently-active
            independent food makers there who would be strong candidates to move
            onto Hotplate — verifying each one live before it ever reaches your
            board. Here is exactly what happens, end to end.
          </p>
        </div>

        {/* Pipeline */}
        <div className="rounded-xl border border-sand bg-white px-6 py-6">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-6">
            The pipeline
          </div>
          <div className="space-y-0">
            {PIPELINE.map((s, i, arr) => (
              <div key={s.step} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full border border-sand bg-cream flex items-center justify-center text-xs font-bold text-coral shrink-0">
                    {s.step}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="w-px flex-1 bg-sand my-1" />
                  )}
                </div>
                <div className={i === arr.length - 1 ? "pb-0" : "pb-6"}>
                  <div className="font-semibold text-sm mb-1 text-ink">
                    {s.label}
                  </div>
                  <p className="text-sm text-muted leading-relaxed">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Guarantees */}
        <div className="mt-6 rounded-xl border border-sand bg-white px-6 py-6">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
            What the verification guarantees
          </div>
          <div className="space-y-4">
            {GUARANTEES.map((g, i) => (
              <div key={g.title}>
                {i > 0 && <div className="border-t border-sand mb-4" />}
                <h3 className="font-semibold text-ink mb-1">{g.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{g.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Models footnote */}
        <p className="mt-6 text-xs text-muted leading-relaxed">
          Models: discovery & outreach run on Claude Sonnet, scoring on Claude
          Haiku. Verification (Hotplate, followers, region) is deterministic HTTP
          — no model calls — which is what keeps it fast and exact.
        </p>
      </div>
    </div>
  );
}
