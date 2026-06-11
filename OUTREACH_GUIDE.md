# ChefScout Outreach Guide

A reference for the outreach team. This doc covers the full flow from filtering sellers to sending a personalized message.

---

## The Feature at a Glance

ChefScout finds high-value independent food makers — bakers, popup chefs, cottage food sellers — and scores their likelihood to switch to Hotplate. The outreach team uses it to run geo-targeted campaigns: pick a city or neighborhood, surface the best candidates, generate personalized messages, and send.

---

## Location Filter

The location input (top of the leaderboard) searches across three data layers:

| Layer | Examples |
|-------|---------|
| **Neighborhood** | "Mission District", "Russian Hill", "Japantown" |
| **City** | "San Francisco", "New York", "Los Angeles" |
| **Metro area** | "Bay Area", "Tri-State Area", "Greater LA" |

The filter is case-insensitive and matches on **substrings**: typing `Mission` matches "Mission District", and `bay` matches "Bay Area". Type one place at a time (a single neighborhood, city, or metro) rather than a phrase like "nyc bakery" — the location box filters by place, and the keyword box (next to it) handles product/name.

### Shorthand aliases that work

Type any of these *on their own* and they expand to the full place name before matching:

| You type | Expands to |
|----------|---------|
| `sf` | San Francisco |
| `bay` | Bay Area |
| `nyc` | New York |
| `la` | Los Angeles |
| `chi` | Chicago |
| `tristate` or `tri state` | Tri-State Area |

Aliases match the whole entry, so type `sf` alone — not `sf cookies` (use the keyword box for "cookies"). These same aliases also drive the region-aware scan, so filtering by `sf` and scanning targets San Francisco correctly.

### Examples

- `Mission` → Mission District sellers (Florecita, Bette's, Mission Tamale)
- `Bay Area` → all current SF sellers
- `Outer Sunset` → SF Mochi Mochi
- `New York` → 0 results today, ready when NYC sellers are added

---

## Keyword Search

The second input (right of location) searches **name, handle, and what they sell**:

- `cookie` → No Crumbs Cookies, Christine's, AP Flour SF
- `mochi` → Jiaqi's Mochi, SF Mochi Mochi, Kaya Bakery
- `empanada` → El Porteno Empanadas

Combine with location: `location = "Mission"` + `keyword = "tamale"` → Mission Tamale only.

---

## Clearing Filters

- Click **×** on either input to clear it instantly
- Or click **Clear filters** in the empty-state message

---

## Export the Filtered List

When filters are active and sellers are visible, a **Copy list** button appears. It copies a clean formatted list to your clipboard, ready to paste into Slack, a spreadsheet, or a brief:

```
Florecita (@florecitapanaderia) — Score: 68 — Mission District, San Francisco
Mission Tamale (@missiontamalesf) — Score: 64 — Mission District, San Francisco
Bette's (@bettesparm) — Score: 71 — Mission District, San Francisco
```

---

## Scan for New Sellers

The **Scan for new sellers** button discovers candidates not yet in the leaderboard.

When a location filter is active, the scan **prioritizes candidates from that region first**. If no region-matched candidates are available, it falls back to the full pool so the scan never returns empty.

The scan phase messages reflect your active location — type "Brooklyn" and the scan shows "Scanning #brooklynfood... / Checking Brooklyn popup vendors..." as visual confirmation.

If the scan surfaces candidates that don't match your active filter, the result message tells you: `Found 2 candidates (1 matches your location filter)` — both are added to the full list; switch off the filter to see them.

---

## Score Sellers

Click **Score all sellers** to run AI scoring on everyone currently visible. Scores are computed by Claude Haiku using a rubric that evaluates:

- **HIGH signals** (+): preorder/drop language in bio, weekly drop cadence, manual ordering (Google Form, Venmo DM), sold-out posts, 1k–50k engaged followers, local pickup model, curated menu, professional photography
- **LOW signals** (−): generic recipe content with no sales pathway, fewer than 500 followers, existing brick-and-mortar at scale

### Score tiers

| Score | Tier | Action |
|-------|------|--------|
| 80–100 | Established | Outreach now — they're ready |
| 60–79 | High-Value | Primary outreach targets |
| 40–59 | Emerging | Warm pipeline, check back in 4–6 weeks |
| 0–39 | Hobbyist | Not a fit yet |

**Switch Readiness** (shown on expanded cards) is a separate 0–100 score focused specifically on how likely they are to adopt a new platform right now.

---

## Generate Outreach

1. Click any scored card to expand it
2. Review the **Signal Breakdown** and **Recommended Action**
3. Click **Generate outreach** — Claude Sonnet writes a personalized DM or email draft
4. The draft opens with a specific account detail (product, caption vibe), names the friction they currently feel (managing DMs, people missing story drops, chasing Venmo), and mentions Hotplate in one natural sentence
5. Click **Copy** and paste directly into Instagram DMs, TikTok DMs, or email

### What makes the outreach good

- The system prompt uses the seller's **city** so Claude writes for a local audience, not a generic SF audience
- The prompt includes **neighborhood** and **metro area** so Claude can reference local context naturally
- Rules explicitly ban em dashes, exclamation points unless natural, and filler phrases like "I came across your page"

---

## Adding Sellers for New Cities

To expand to NYC, Chicago, LA, or anywhere else:

1. Add seller objects to `data/sellers.json` with the correct `city`, `neighborhood`, and `metro_area`
2. Add discovery candidates to `data/discovery_pool.json` the same way
3. No code changes needed — the location filter, scan, and outreach all adapt automatically

**Example for a Brooklyn seller:**
```json
{
  "city": "New York",
  "neighborhood": "Williamsburg",
  "metro_area": "Tri-State Area"
}
```

The outreach team can then type `nyc`, `brooklyn`, or `tri-state` to filter to that market.

---

## Full Outreach Workflow

```
1. Open ChefScout (/)
2. Type a location — "Mission District", "Bay Area", "New York"
3. Optionally narrow by keyword — "tamale", "cookie", "mochi"
4. Click Score all sellers (or Re-score all to refresh)
5. Sort is automatic — highest scores surface first
6. Click a High-Value or Established card to expand
7. Read Signal Breakdown and Recommended Action
8. Click Generate outreach → review the draft
9. Click Copy → paste into Instagram DM / TikTok / email
10. Optional: click Copy list to export the filtered view to Slack or a sheet
```

---

## Architecture Notes

The full production pipeline (visible at `/architecture`) runs six steps continuously:

1. **Discover** — weekly cron scans hashtags, location tags, Off the Grid, cottage food registry
2. **Score** — Claude Haiku batch-scores new discoveries and re-scores existing weekly
3. **Rank & filter** — surface top 20: score > 60, no permanent storefront, local pickup, not already on Hotplate
4. **Outreach** — Claude Sonnet drafts personalized DMs; team reviews and sends
5. **Activate** — accepted invites trigger guided onboarding with first drop pre-configured
6. **Feed back** — conversion outcomes by tier/channel retrain scoring weights over time

The loop compounds: every activation makes the rubric smarter, and weekly re-scoring catches popups 3–6 months before they'd sign a lease.
