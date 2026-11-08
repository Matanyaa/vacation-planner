# Vacation Planner — Spec

**Status:** confirmed
**Mode:** real-use
**Repo (proposed):** github.com/Matanyaa/vacation-planner

## Purpose
Plan vacations by cost: build and compare several options (even abstract ones, for a ballpark price), then track the chosen one's real spending, with accurate ₪ costs across currencies and payment methods.

## Users & devices
- Single user
- Phone-first, also used on desktop
- Offline: everything that can work offline should. Online is needed only for current exchange rates, syncing, and receiving documents (phase 2). Offline entries use the last known rate, shown as an estimate until updated.

## Phases
- **v1 – costs:** everything in this spec
- **Phase 2 – itinerary + documents:** timeline built from dated entries; booking documents attached and received. v1 data must already support this (dates, places, connection legs).

## Structure
- **Vacation:** top-level container (e.g. "Summer 2027").
- **Plan / trip:** same fields; the difference is status.
  - **Plan:** planning phase, not chosen. A vacation can hold several fully independent plans (any country, length, type).
  - **Trip:** the chosen plan, in implementation. At most one per vacation.
- **Choosing** a plan makes it the trip; other plans stay as hidden backups.
- **Finalizing** makes the trip and the vacation one and the same; all other plans are erased.
- **Save for reuse:** any plan can be saved and brought into a future vacation.
- **Past trips** are entered retroactively as normal trips with past dates.
- **Plans** don't touch the wallet; foreign amounts use the current rate.
- **Template** for a new plan/trip: dates, flights, sleep.
- Rough plan numbers are entered manually.

### Plan/trip info
Name, destination(s), start and end dates, number of travelers.

## Categories
- Transportation, with a **method** field (pick from an editable list: flight, cruise, train, bus, rental car, taxi, ferry…)
- Food: breakfast, lunch, dinner, snacks
- Sleep
- Attractions
- Insurance
- Visa / documents
- Connectivity
- Shopping
- Other (includes losses, conversion losses, card fees, write-offs)

### Bundled payments
- One payment can belong to several categories (e.g. cruise fare = Transportation + Sleep + Food). No percentage split.
- In comparisons, linked categories are merged across everything being compared, transitively, with a note explaining why.

### Connections
- Entries follow payments: a connection on one ticket is one entry; two tickets are two entries.
- Either way it's marked as a connection, with its legs recorded (for phase 2).

## Tags
- Free-form; "terminal" is built in.
- Examples: terminal, offer-discount, gratuity.
- **Discounts:** only the final amount paid counts; a discount can be tagged "offer-discount".

## Gratuity
- An add-on to an expense: fixed amount, percentage of the expense, or per person per day (number of days or a date range).
- Counts toward the parent expense's category and is tagged "gratuity".

## Comparison
- Compare any mix of plans and trips (including past trips and other vacations).
- Choose categories to compare: one, several, or all.
- Linked categories from bundled payments are merged (see above).

## Money
### Basics
- Comparison currency: ₪.
- Every transaction logs its actual rate **and** the official rate that day.
- When both the ₪ and foreign price are known, both are logged.

### Wallet
- One wallet, outside trips; serves any implemented trip. Plans don't use it.
- Balances are per **currency + form**. Forms:
  - **Cash:** any currency
  - **Bank:** foreign currency in the bank, spent by card (realistically $, €)
  - **Gift card / credit:** restricted to a specific use; valued at the official rate on the date received. Applied only against actual charges, never moved in ahead of time.
  - **Special account** (e.g. cruise onboard account): charges build up and are settled later by a regular payment (and/or gift card).
- Each balance has an **average rate**. Money coming in changes the average; spending removes money at the average rate and doesn't change it.
- A bank balance can go negative; settled later by buying foreign currency.
- Unsettled charges (special account, negative bank balance) show an **estimate** at the official rate. Any trip total that includes them is marked as an estimate until settled.

### Transactions
0. **Existing money:** cash/bank money not yet in the app enters at the official rate on the day it's logged.
1. **ATM withdrawal:** log the ₪ actually charged.
2. **Exchange between currencies:** log both amounts. Source can be cash or bank (bank realistically $ ↔ €). The new balance's ₪ cost comes from the money given up.
3. **Buying foreign currency in the bank:** the bank's rate is built in.
4. **Card payment:** either against a bank balance (at its average rate), or a standalone charge with its own rate (₪ charged ÷ foreign amount).
5. **Paying in ₪:** no conversion (Israeli terminal, sites showing ₪).
6. **Refund** (cash or to bank): if at the same rate as the original, adjust the original expense; if at a different rate, a new refund transaction with its own rate.

### Leftovers and off-trip use
- A trip counts only what was spent on it. Leftover money stays in the wallet at its average rate for later use.
- **Off-trip transactions:** logged without a trip; adjust the balance and record the actual rate.
- **Forgotten transactions:** correct the balance to the real amount; the difference is valued at the official rate on the correction day and isn't counted against any trip.

## Tech (per app-build-standards)
- Plain HTML/CSS/JS, split into separate files / ES modules from the start (the app is large), no build step
- Firebase Auth (real login), Firestore with offline persistence, rules scoped to the user
- GitHub Pages hosting; web app manifest for home-screen install; "update available, refresh?" prompt

## Decisions (resolved 2026-11-02)
- **Comparison basis:** total, per person, per day, and per person per day, with a toggle on the comparison screen.
- **Exchange rate source:** Bank of Israel representative rates as primary; open.er-api.com as fallback for currencies BOI doesn't publish (e.g. GEL). Check during the build that BOI can be called from the browser (CORS).
- **Sign-in method:** Google only.
- **App/repo name:** vacation-planner (github.com/Matanyaa/vacation-planner → https://matanyaa.github.io/vacation-planner/).
