# ChefScout

A growth tool for Hotplate. ChefScout finds high-value independent food makers in San Francisco who are ready to switch to a drops-based platform, scores them by switch-readiness, and drafts personalized outreach for each one.

The demo is a leaderboard of SF food makers, each with an AI-generated value score, a breakdown of the signals behind the score, and a ready-to-copy outreach message. Scores are preloaded so the demo works instantly. You can also re-score any seller live against Claude.

---

## What it does

**Scoring** - Claude Haiku evaluates each seller against a rubric: drop cadence, manual ordering method (DM, Google Form, Venmo), sold-out frequency, follower range, and SF pickup model. Returns a 0-100 score, tier label, and signal breakdown.

**Outreach generation** - Claude Sonnet writes a short personalized message for each seller. It leads with their specific pain (clunky ordering, sold-out chaos) before mentioning Hotplate. The draft is channel-native, short, and sounds human.

**Architecture page** - Shows what the production discovery engine would scan: Instagram hashtags, TikTok, Off the Grid vendor lists, Eventbrite, the California cottage food registry, and Hotplate itself. Scraping is not implemented in this prototype. Sellers come from a manually curated seed file.

---

## Running it locally

You need an Anthropic API key. Get one at console.anthropic.com.

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
  api/score/route.ts        POST - scores a seller profile via Claude Haiku
  api/outreach/route.ts     POST - generates outreach draft via Claude Sonnet
  page.tsx                  Main leaderboard view
  architecture/page.tsx     Production discovery architecture explainer

components/
  Leaderboard.tsx           Sorted list with parallel scoring, preloaded scores as default
  SellerCard.tsx            Expandable card with signal breakdown and outreach generation
  ArchitecturePanel.tsx     Discovery sources list

data/
  sellers.json              16 real-ish SF food makers (manually curated)
  scores.json               Preloaded scores so the demo works without an API call
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

Add `ANTHROPIC_API_KEY` to your Vercel project environment variables before deploying. The app has no database and no auth. It is a static-first Next.js app with two serverless API routes.

---

## Cost

A full demo run (16 sellers scored plus all outreach drafts generated) costs about $0.10 to $0.15 in API fees. Preloaded scores mean the leaderboard shows immediately at zero cost. Live scoring and outreach generation only fire when a user clicks the buttons.

Models used:
- Scoring: `claude-haiku-4-5-20251001` (fast, cheap)
- Outreach: `claude-sonnet-4-6` (higher quality for the draft that gets copied)

---

## Demo script

This is the 60-second walk-through for a screen share.

1. Open the URL. The leaderboard is already scored and sorted. Established sellers are at the top.
2. Click the top card. Read the signal breakdown out loud. Point to the tier badge and switch-readiness score.
3. Click "Generate outreach." Wait 3 seconds. Read the draft. It references the seller's actual product and their specific ordering pain.
4. Copy the draft.
5. Optional: click Architecture in the nav. Show what the production discovery engine would scan.

---

## What is a prototype and what is not

**Working live:**
- Scoring endpoint, calling real Claude with real seller data
- Outreach generation endpoint, same
- Preloaded scores for instant demo load
- Deployed Vercel URL

**Stubbed / architecture-only:**
- Discovery and scraping layer (sellers are from a JSON seed file)
- Activation and onboarding automation (described on the architecture page)
- Funnel tracking (mentioned as a next-phase concept)

---

## Adding sellers

Edit `data/sellers.json`. Each entry looks like this:

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

To preload a score, add a matching entry to `data/scores.json` keyed by the seller's `id`. Without a preloaded score, the card shows a blank score until the user clicks "Score all sellers."
