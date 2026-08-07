import { describe, expect, it } from 'vitest'
import type { Basket, Vendor } from '../domain/types.ts'
import { COURIERS, CUSTOMER_AREAS, MEETING_POINTS, VENDORS } from '../fixtures/doha.ts'
import { DEFAULT_CONFIG } from '../planner/courierRun.ts'
import { routedEta } from '../routing/matrix.ts'
import { holderOf } from './custody.ts'
import { execute, type Disruption } from './execute.ts'

const config = { ...DEFAULT_CONFIG, eta: routedEta }
const vendor = (id: string) => VENDORS.find((v) => v.id === id) as Vendor

function basketOf(ids: string[], customerIndex = 0): Basket {
  return {
    id: 'b',
    placedAt: 0,
    customer: { ...CUSTOMER_AREAS[customerIndex] },
    orders: ids.map((id) => {
      const v = vendor(id)
      return {
        vendorId: v.id,
        vendor: v,
        value: 100,
        temperature: 'hot' as const,
        readyAt: v.prepMinutes * 60_000,
      }
    }),
  }
}

function run(ids: string[], disruptions: Disruption[] = [], customerIndex = 0) {
  return execute({
    basket: basketOf(ids, customerIndex),
    couriers: COURIERS,
    meetingPoints: MEETING_POINTS,
    config,
    disruptions,
  })
}

describe('an undisturbed run', () => {
  it('produces a custody record with no violations', () => {
    const result = run(['v-lusail', 'v-pearl'])

    expect(result.violations).toEqual([])
    expect(result.replans).toBe(0)
    expect(result.slipMs).toBe(0)
  })

  it('ends with every order at the customer', () => {
    const basket = basketOf(['v-lusail', 'v-pearl'])
    const result = run(['v-lusail', 'v-pearl'])

    for (const order of basket.orders) {
      expect(holderOf(result.events, order.vendorId)).toEqual({ kind: 'customer' })
    }
  })
})

describe('a kitchen running late', () => {
  it('replans and reports how much later the basket now lands', () => {
    // The news arrives a minute in, before anything has been collected.
    const result = run(['v-lusail', 'v-pearl'], [
      { at: 60_000, type: 'kitchen:late', vendorId: 'v-pearl', byMinutes: 25 },
    ])

    expect(result.replans).toBe(1)
    expect(result.slipMs).toBeGreaterThan(0)
    expect(result.violations).toEqual([])
  })

  it('leaves goods already collected with the courier who collected them', () => {
    const undisturbed = run(['v-lusail', 'v-pearl'])
    const firstCollection = undisturbed.events.find((event) => event.type === 'collected')
    expect(firstCollection).toBeDefined()
    if (firstCollection?.type !== 'collected') return

    // Disrupt after that collection has happened.
    const result = run(['v-lusail', 'v-pearl'], [
      {
        at: firstCollection.at + 1000,
        type: 'kitchen:late',
        vendorId: 'v-pearl',
        byMinutes: 30,
      },
    ])

    // Replanning may reroute the carrier, but it cannot put the goods back on a
    // shelf or hand them to someone else without a handover.
    const carrier = result.events.find(
      (event) => event.type === 'collected' && event.vendorId === firstCollection.vendorId,
    )
    expect(carrier).toBeDefined()
    if (carrier?.type !== 'collected') return
    expect(carrier.courierId).toBe(firstCollection.courierId)
    expect(result.violations).toEqual([])
  })

  it('keeps custody valid across several pieces of bad news', () => {
    const result = run(['v-lusail', 'v-pearl', 'v-souq'], [
      { at: 30_000, type: 'kitchen:late', vendorId: 'v-pearl', byMinutes: 10 },
      { at: 120_000, type: 'courier:delayed', courierId: 'c-1', byMinutes: 8 },
      { at: 300_000, type: 'kitchen:late', vendorId: 'v-souq', byMinutes: 15 },
    ])

    expect(result.violations).toEqual([])
    expect(result.replans).toBeGreaterThan(0)
    expect(result.plans.length).toBe(result.replans + 1)
  })
})

describe('what replanning refuses to do', () => {
  it('never collects the same goods twice, however often it replans', () => {
    const result = run(['v-lusail', 'v-pearl'], [
      { at: 60_000, type: 'kitchen:late', vendorId: 'v-pearl', byMinutes: 5 },
      { at: 90_000, type: 'kitchen:late', vendorId: 'v-pearl', byMinutes: 5 },
      { at: 150_000, type: 'kitchen:late', vendorId: 'v-pearl', byMinutes: 5 },
    ])

    const collections = result.events.filter((event) => event.type === 'collected')
    const vendors = collections.map((event) => event.vendorId)

    expect(new Set(vendors).size).toBe(vendors.length)
    expect(result.violations).toEqual([])
  })
})
