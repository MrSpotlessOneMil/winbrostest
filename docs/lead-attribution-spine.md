# Lead Attribution Spine — channel P&L (cost per booked job)

**What this adds:** the missing metric behind the whole lead-gen program — **cost per booked
job, per marketing channel** — plus ROAS and book rate. Purely additive (no schema changes, no
changes to lead intake); it's a read-layer over data we already capture.

## The problem it solves
- The website webhook pins `leads.source = 'website'` (DB CHECK constraint) and stashes the real
  detail (`area-santa-monica`, UTMs) in `form_data`. So every one of the 636 SEO pages, plus GBP,
  social, and direct traffic, collapsed into a single "website" bucket.
- Nothing joined **ad spend → booked jobs**, so cost-per-booked-job (the number that decides
  whether to scale a channel) was unmeasurable. The July 2026 lead-gen audit graded this an "F".

## What's in this PR
| File | Purpose |
|---|---|
| `lib/marketing/attribution.ts` | Pure `normalizeChannel()` — decodes `leads.source` + `form_data.source_detail` + UTMs + LSA markers into one canonical channel (`lsa`, `seo`, `gbp`, `social`, `paid_search`, `email`, `referral`, `phone`, `direct`). Single source of truth. |
| `tests/unit/attribution.test.ts` | 14 unit tests covering every channel + precedence rules. |
| `lib/marketing/channel-pnl.ts` | Shared P&L computation (`computeChannelPnl`) used by both the API route and the weekly cron. |
| `app/api/actions/insights/channel-pnl/route.ts` | `GET /api/actions/insights/channel-pnl?range=30d` — the scoreboard. Admin-gated (`requireAuthWithTenant`). |
| `app/api/cron/weekly-channel-report/route.ts` | Weekly self-report cron → texts the owner a plain-language P&L digest + logs the full report as a `system_event`. **Opt-in per tenant** via `workflow_config.weekly_channel_report === true` (default OFF, so it never messages other tenants). Register a weekly QStash schedule → `GET /api/cron/weekly-channel-report`. |

## The scoreboard endpoint
`GET /api/actions/insights/channel-pnl?range=7d|30d|90d|ytd|custom&from=&to=`

Returns per channel: `leads, bookedJobs, revenue, spend, costPerLead, costPerBookedJob,
revenuePerBookedJob, bookRate, roas`, plus blended totals.

**Attribution model:** first-touch. Every completed job is credited to the channel of that
customer's **earliest** lead (via `normalizeChannel`).

**Spend today:** LSA from `system_events.LSA_METRICS_SNAPSHOT.metadata.currentPeriodTotalCost`
(month-to-date account total). Other channels read optional monthly costs from
`tenant.workflow_config.channel_costs` (prorated to the range), else $0 (organic).

## Known limitations / intended follow-ups
1. **LSA spend is the account month-to-date total**, not per-range-exact. For precise weekly spend,
   diff consecutive snapshots (a small follow-up).
2. **Revenue excludes recurring LTV** — it's first-job completed-job price. Recurring value is the
   bigger prize; add a members/LTV join next.
3. **Optional: expand the `leads.source` CHECK constraint** to allow granular channels
   (`seo`,`gbp`,`social`,`email`) so `leads.source` stores the channel directly at write time, and
   set it in the website webhook via `normalizeChannel`. Report already works without this.
4. **Weekly rollup:** wire a cron to hit this endpoint and post the scoreboard to Telegram/Slack.
5. **Cross-system merge:** social + cold-email attribution also live in the content-machine DB;
   a future combined view unifies all channels for the RobinLine "lead-gen addon" dashboard.

## Why it matters for the product
This is the dataset that (a) tells us which channel to scale (the audit sim showed 2× LSA budget is
+$48k/yr **but only if cost/booked-job stays ≤ ~$110** — now measurable), and (b) becomes the
"here's your live P&L per channel" proof for selling lead-gen as a RobinLine addon.
