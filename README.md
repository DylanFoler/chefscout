# ChefScout

A growth tool for Hotplate. ChefScout finds high-value independent food makers in San Francisco who are ready to switch to a drops-based platform, scores them by switch-readiness, and drafts personalized outreach for each one.

The demo is a leaderboard of 13 real SF food makers, each with an AI-generated value score, a signal breakdown, and a ready-to-copy outreach message. Scores are preloaded so the demo works instantly with no API calls. Live scoring, outreach generation, and discovery scanning are available when an API key is present.

---

## What it does

**Scoring** - Claude Haiku evaluates each seller against a rubric: drop cadence, manual ordering method (DM, Google Form, Venmo), sold-out frequency, follower range, and SF pickup model. Returns a 0-100 score, tier label, switch-readiness score, and signal breakdown.

**Outreach generation** - Claude Sonnet writes a short personalized DM for each seller. Opens with a specific detail from their account, names the friction they feel right now, mentions Hotplate in one natural sentence. Sounds like a person, not a pitch.

**Scan for new sellers** - Surfaces new SF food maker candidates from a curated discovery pool. Newly found sellers appear with a green badge and auto-score immediately.

**Architecture page** - Shows the full 6-step continuous pipeline: Discover, Score, Rank, Outreach, Activate, Feed back. Explains how the scoring rubric compounds as conversion data comes in and how the system expands to new cities.

---

## Running it locally

You need an Anthropic API key for live scoring and outreach. Get one at console.anthropic.com. The leaderboard and scan work without one.

```bash
git clone https://github.com/DylanFoler/chefscout
cd chefscout
npm install
```

Create `.env.local` in the project root:

```
ANTHROPIC_API_KEY=your_key_here
```

Start the dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## Project structure

```
app/
  api/score/route.ts        POST - scores a seller via Claude Haiku
  api/outreach/route.ts     POST - generates outreach draft via Claude Sonnet
  api/scan/route.ts         POST - surfaces new sellers from discovery pool
  page.tsx                  Main leaderboard view
  architecture/page.tsx     Discovery architecture and continuous pipeline

components/
  Leaderboard.tsx           Sorted list, parallel scoring, scan button
  SellerCard.tsx            Expandable card with signal breakdown and outreach
  ArchitecturePanel.tsx     Discovery sources list

data/
  sellers.json              13 verified real SF food makers
  scores.json               Preloaded scores for instant demo load
  discovery_pool.json       6 additional sellers surfaced by the scan button
  discovery_sources.json    What the production engine would scan

lib/
  anthropic.ts              Anthropic client
  types.ts                  Shared TypeScript types
```

---

## Deploying to Vercel

```bash
vercel --prod
```

Add `ANTHROPIC_API_KEY` to your Vercel project environment variables. The app has no database and no auth.

---

## Cost

A full demo run (13 sellers scored plus all outreach drafts) costs about $0.10 to $0.15 in API fees. Preloaded scores mean the leaderboard shows immediately at zero cost. Scoring and outreach only fire when a user clicks.

Models used:
- Scoring: `claude-haiku-4-5-20251001` (fast, cheap)
- Outreach: `claude-sonnet-4-6` (higher quality for the draft that gets copied)

---

## Demo script

60 seconds on a screen share.

1. Open the URL. Leaderboard is already scored and sorted. Established sellers at the top.
2. Click the top card. Read the signal breakdown. Point to the tier badge and switch-readiness score.
3. Click "Generate outreach." Read the draft — it names their actual product and their specific pain.
4. Copy the draft.
5. Click "Scan for new sellers." Watch it animate through sources, surface 2 new cards, and auto-score them.
6. Optional: click Architecture. Walk through the 6-step continuous pipeline.

---

## What works live vs what is stubbed

**Working:**
- Preloaded leaderboard, instant load, no API needed
- Scoring endpoint with real Claude and real seller data
- Outreach generation with personalized DM drafts
- Scan button surfacing new sellers and auto-scoring them
- Architecture page with full pipeline diagram

**Stubbed / described only:**
- Production discovery scraping (Instagram hashtags, Off the Grid, cottage food registry)
- Activation and onboarding automation
- Funnel tracking and rubric retraining on conversion data

---

## Adding sellers

Edit `data/sellers.json`:

```json
{
  "id": "yourhandle",
  "handle": "@yourhandle",
  "name": "Brand Name",
  "platform": "instagram",
  "followers": 8000,
  "city": "San Francisco",
  "what_they_sell": "Sourdough loaves and focaccia",
  "current_order_method": "DM to order, Venmo payment",
  "drop_cadence": "Weekly Friday drops",
  "notable_signals": ["Sold out posts", "Pickup only in Mission"],
  "sample_post_caption": "Optional recent caption for outreach personalization"
}
```

To preload a score, add a matching entry to `data/scores.json` keyed by the seller's `id`. To add to the scan pool, add to `data/discovery_pool.json` with the same shape.
