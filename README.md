# Cross-vendor dispatch

Order from two shops on a delivery app and you pay two delivery fees, wait
twice and answer the door twice. The platform's unit of work is the
vendor-order, not your basket, and you absorb the difference.

This makes the basket the unit. Given several vendors and one customer, it
plans three ways to serve them, scores each on what it costs to run and what it
does to the goods, and works out what each vendor should pay towards a delivery
they shared.

## Quick start

```bash
npm install
npm run dev
```

Nothing else is needed. Travel times ship as a precomputed table, so there is
no server, no API key and no routing engine to run.

## The three plans

|  |  |
| --- | --- |
| **Separate** | A courier per vendor, each driving to the customer. What a basket costs today. |
| **Sequential** | One courier tours every vendor, then delivers once. What the large platforms ship, where they ship anything. |
| **Rendezvous** | Couriers collect in parallel, meet at a chosen point, and one carries everything onward. |

The interesting question is not how to perform a handover. It is which of the
three a given basket warrants, and whether any of them beats simply sending two
couriers.

## What the numbers say

Running every pair of Doha vendors to every customer area on measured road
times — 792 baskets:

|  | separate | one courier, both vendors | handover |
| --- | --- | --- | --- |
| ambient goods | 11% | 85% | 4% |
| hot goods | 31% | 64% | 5% |

**Combining beats a courier per vendor in 79% of baskets, saving a median 19%
of what separate deliveries would have cost.**

For the customer that is a median bill of **71.66 QAR for two deliveries today
against 52.31 QAR for one** — a quarter off, and one doorstep visit instead of
two.

It is a trade, not a free win. One courier covering both vendors is cheaper to
run than two working in parallel, and slower: the median basket arrives **two
minutes later**, and more than half arrive later at all. On about one basket in
twenty the customer pays more, because the plan is chosen on total cost
including freshness rather than on the customer's fee alone. A version that
sold this as strictly better would be lying.

Almost all of that comes from one courier touring both vendors rather than from
a handover, which wins about one basket in twenty. Hot goods push towards
separate deliveries, because every minute a shared plan adds is a minute the
food spends getting worse.

## Why a controlled sweep says the opposite

`src/bench/sweep.ts` places two vendors on a circle around the customer and
varies the angle between them and the gap between their kitchens. It reports
consolidation winning around 30% of the time — nothing like 79%.

Both numbers are right. The sweep sets the angle uniformly from 0° to 180°, and
past 60° a shared delivery can never win, so half its cells are foregone
conclusions. Real vendors are not scattered uniformly around a customer; Doha's
sit along a corridor, and most real pairs fall inside the angle where combining
is worth attempting.

That makes the sweep useful for isolating what each variable does, and useless
as a headline. It answers a question about a city that does not exist. Kept for
the first job, not the second.

Sweeping those two variables gives a clear answer and a clear limit.

```text
ambient goods, vendors 8km out

  skew\spread   0°  15°  30°  45°  60°  90° 120° 150° 180°
      0min       R    ~    ~    ~    ~    ~    ~    .    .
     10min       S    ~    R    ~    .    .    .    .    .
     30min       R    R    ~    .    .    .    .    .    .

  . separate   S sequential   R handover   ~ too close to call
```

A quarter of the grid is `~`. Travel times come from free-flow speed limits
with no congestion and the cost figures are illustrative, so nothing here is
accurate to a percent — and half the contested cells are decided by less than
that. Reporting a winner in them would be inventing a preference. Those cells
are also exactly the ones that appeared to flip at random before ties were
reported, which turned out to be the model expressing confidence it did not
have rather than a defect in the search.

**Past 60° of spread, a handover never wins.** Not with better timing, not with
scheduling, not at any distance. When the vendors sit on opposite sides of the
customer no meeting point lies on both couriers' routes, so somebody must
double back. One traced plan sent a courier from Lusail to a petrol station in
45 minutes when driving straight to the customer took 27 — past the customer,
to meet, then back again. That wall is geometric and nothing temporal moves it.

**Inside 60°, timing decides it.** Which is where two things matter that were
not obvious at the start:

*Aligning the couriers is the whole game.* A handover cannot happen until both
are present, so the earlier courier should simply start later. Removing that
wait rather than relocating it from the vendor counter to the roadside doubled
the share of geometries where a handover wins, from 11% to 22%. Prep skew stops
being what rules a rendezvous out.

*Scheduling the kitchen is a quality lever, not a strategy one.* A vendor that
can be told when to start cooks to meet its courier instead of leaving food to
sit. On a badly skewed pair that delivers the early vendor's goods twenty
minutes fresher, at nobody's expense, because the customer was always waiting
on the slower kitchen. It improves whichever plan you were going to choose, so
it rarely changes which one that is.

**Within the sweep's uniform geometry, separate deliveries win most cells.**
Read that as a statement about the sweep, not about Doha — the field study
above is the one to quote. What the sweep establishes is *why* a basket goes
one way or the other, which is the part that transfers.

## Who pays

One delivery, several vendors, one bill to divide. Splitting it evenly charges
a vendor sitting on the route the same as one that dragged the courier ten
minutes off it. Splitting it by basket value is worse: it regularly charges a
vendor **more than delivering alone would have cost them**, at which point that
vendor leaves and the whole arrangement collapses.

Each vendor is instead billed its average marginal contribution across every
order it could have joined in — the Shapley value. The shares sum exactly to
the joint cost, a vendor that adds nothing pays nothing, and the interface
marks any share that exceeds what a vendor would have paid alone, since that is
the moment a split stops being merely unfair and becomes refusable.

## Travel times

Straight-line distance with a fixed detour factor is wrong in both directions
at once. It undercharges short urban hops full of junctions and one-way
systems, and overcharges long runs down fast, direct highways — Msheireb to
Souq Waqif costs a fifth more than the estimate allowed, Lusail to Al Wakrah a
third less. No single factor repairs that.

So the times are measured. `tools/build-routing-matrix.sh` fetches the Gulf
OpenStreetMap extract, builds a routing graph with OSRM and writes a table of
driving times between every fixed place:

```bash
./tools/build-routing-matrix.sh    # needs Docker, ~3GB disk, a few minutes
```

Only the 60KB result is committed. Running the app never touches any of it.

Two limits worth stating. OSRM's car profile uses free-flow speed limits, so
these times are optimistic in exactly the way the old estimate was pessimistic,
and congestion is not modelled. And the table covers the fixed places only —
the regime sweep invents synthetic geometry no real road serves, so it still
uses the straight-line estimate.

## Not modelled

Deliberate omissions, each of which would change the answers:

- **Several customers per courier.** Batching across baskets is a different
  problem — assignment across a fleet rather than planning one basket — and it
  would swamp the result above.
- **Execution.** These are plans. A courier who is late, a handover where one
  party never arrives, a disputed transfer: all of that needs custody as an
  append-only log rather than a field, plus tolerance windows and replanning.
- **Congestion and stochastic travel.** Planning to the second is fake
  precision when kitchens run late and traffic is a distribution.
- **Why the incumbents avoid this.** Handovers add minutes and an open bag,
  which is fine for retail and hostile to hot food; custody disputes between
  two contractors are expensive; and couriers paid per delivery dislike doing
  half a job. A version anyone would ship needs an answer to the third.

## Layout

```text
src/domain/      types, and the geometry helpers
src/routing/     the travel-time seam: measured table, straight-line fallback
src/planner/     the three strategies, scoring, and cost allocation
src/bench/       the regime sweep
src/ui/          map projection and rendering
tools/           the routing pipeline, run by hand when fixtures change
```

The planner is pure and knows nothing about React, which is why the regime
sweep can run it a few thousand times in a test.

```bash
npm test         # unit tests, including the claims made above
npm run build
```
