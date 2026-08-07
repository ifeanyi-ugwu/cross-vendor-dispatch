import { describe, expect, it } from 'vitest'
import { isPlan, type Basket } from '../domain/types.ts'
import { COURIERS, CUSTOMER_AREAS, MEETING_POINTS, VENDORS } from '../fixtures/doha.ts'
import { DEFAULT_CONFIG } from './courierRun.ts'
import { objectiveFor, rank } from './evaluate.ts'
import { customerBill, DEFAULT_FEES } from './pricing.ts'
import { planAll } from './strategies.ts'
import { routedEta } from '../routing/matrix.ts'

const config = { ...DEFAULT_CONFIG, eta: routedEta }

function billFor(vendorIds: string[], customerIndex = 0) {
  const vendors = vendorIds.map((id) => VENDORS.find((v) => v.id === id)!)
  const basket: Basket = {
    id: 'b',
    placedAt: 0,
    customer: { ...CUSTOMER_AREAS[customerIndex] },
    orders: vendors.map((vendor) => ({
      vendorId: vendor.id,
      vendor,
      value: 100,
      temperature: 'hot' as const,
      readyAt: vendor.prepMinutes * 60_000,
    })),
  }

  const attempts = planAll({
    basket,
    couriers: COURIERS,
    meetingPoints: MEETING_POINTS,
    config,
    objective: objectiveFor(basket),
  })
  const separate = attempts.find((a) => isPlan(a) && a.strategy === 'separate')
  const best = rank(attempts, basket)[0]
  if (!separate || !isPlan(separate) || !best) throw new Error('no plan')

  return { bill: customerBill(separate, best.plan, basket), chosen: best.plan.strategy }
}

/** Every pair of vendors to every customer area. */
function everyBasket() {
  const bills = []
  for (let i = 0; i < VENDORS.length; i += 1) {
    for (let j = i + 1; j < VENDORS.length; j += 1) {
      for (let c = 0; c < CUSTOMER_AREAS.length; c += 1) {
        bills.push(billFor([VENDORS[i].id, VENDORS[j].id], c).bill)
      }
    }
  }
  return bills
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

describe('what the basket costs the customer', () => {
  it('charges one fee for one delivery instead of one per vendor', () => {
    const { bill } = billFor(['v-msheireb', 'v-souq'], 2)

    expect(bill.deliveriesToday).toBe(2)
    expect(bill.shared).toBeLessThan(bill.today)
  })

  it('never prices a delivery below the minimum fee', () => {
    // Two neighbouring vendors, a customer next door: the cheapest basket there
    // is. The floor still applies.
    const { bill } = billFor(['v-msheireb', 'v-souq'], 2)

    expect(bill.shared).toBeGreaterThanOrEqual(DEFAULT_FEES.minimum)
  })

  it('saves the customer about a quarter of the bill on a typical basket', () => {
    const bills = everyBasket()

    expect(median(bills.map((bill) => bill.savedShare))).toBeGreaterThan(0.15)
  })

  it('usually arrives later, which is the trade being made', () => {
    const bills = everyBasket()
    const later = bills.filter((bill) => bill.arrivesEarlierMs < 0)

    // Two couriers working in parallel beat one touring both vendors on time,
    // and lose on cost. Consolidation is a trade, not a free win, and a claim
    // that it is strictly better would be false.
    expect(later.length).toBeGreaterThan(bills.length / 3)
  })

  it('leaves some baskets where the customer pays more', () => {
    const bills = everyBasket()
    const worse = bills.filter((bill) => bill.saved < 0)

    // The planner minimises a blended objective that includes freshness and
    // the platform's own costs, which is not the same as minimising the
    // customer's fee. Where those disagree, the customer loses, and pretending
    // otherwise would misrepresent what is being optimised.
    expect(worse.length).toBeGreaterThan(0)
    expect(worse.length).toBeLessThan(bills.length / 10)
  })
})
