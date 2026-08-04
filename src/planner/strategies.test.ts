import { describe, expect, it } from 'vitest'
import { isPlan, type Basket, type Courier, type Vendor } from '../domain/types.ts'
import { MEETING_POINTS } from '../fixtures/doha.ts'
import { DEFAULT_CONFIG, runCollection } from './courierRun.ts'
import { objectiveFor } from './evaluate.ts'
import { planRendezvous, planSeparate, planSequential, type PlanningInput } from './strategies.ts'
import { straightLineEta } from '../routing/eta.ts'

const config = { ...DEFAULT_CONFIG, eta: straightLineEta }

const vendor = (id: string, lat: number, lng: number, prepMinutes: number): Vendor => ({
  id,
  label: id,
  lat,
  lng,
  prepMinutes,
})

const courier = (id: string, lat: number, lng: number): Courier => ({
  id,
  name: id,
  label: id,
  lat,
  lng,
  vehicle: 'car',
  availableAt: 0,
})

function basketOf(vendors: Vendor[], customer = { id: 'c', label: 'Customer', lat: 25.2854, lng: 51.531 }): Basket {
  return {
    id: 'b',
    placedAt: 0,
    customer,
    orders: vendors.map((v) => ({
      vendorId: v.id,
      vendor: v,
      value: 100,
      temperature: 'ambient' as const,
      readyAt: v.prepMinutes * 60_000,
    })),
  }
}

function inputOf(vendors: Vendor[], couriers: Courier[]): PlanningInput {
  const basket = basketOf(vendors)
  return { basket, couriers, meetingPoints: MEETING_POINTS, config, objective: objectiveFor(basket) }
}

describe('runCollection', () => {
  it('leaves later rather than standing at a kitchen that is not ready', () => {
    const slow = vendor('v', 25.3, 51.53, 40)
    const rider = courier('c', 25.2854, 51.531)
    const basket = basketOf([slow])

    const run = runCollection(rider, basket.orders, config)

    // The wait is absorbed by departing later, not by idling at the counter.
    expect(run.idleSeconds).toBeCloseTo(0, 5)
    expect(run.legs[0].departAt).toBeGreaterThan(0)
    // It still cannot collect before the goods exist.
    expect(run.collectedAt.v).toBeGreaterThanOrEqual(slow.prepMinutes * 60_000)
  })

  it('cannot defer past the tightest stop in a multi-vendor run', () => {
    const quick = vendor('quick', 25.29, 51.53, 1)
    const slow = vendor('slow', 25.3, 51.54, 45)
    const rider = courier('c', 25.2854, 51.531)
    const basket = basketOf([quick, slow])

    const run = runCollection(rider, basket.orders, config)

    // Deferring far enough to avoid the slow kitchen would miss nothing at the
    // quick one, so some waiting is unavoidable and must be visible.
    expect(run.idleSeconds).toBeGreaterThan(0)
  })
})

describe('rejections', () => {
  it('refuses separate deliveries when there are not enough couriers', () => {
    const attempt = planSeparate(
      inputOf([vendor('a', 25.3, 51.53, 5), vendor('b', 25.28, 51.5, 5)], [courier('c', 25.29, 51.52)]),
    )

    expect(isPlan(attempt)).toBe(false)
    if (!isPlan(attempt)) expect(attempt.reason).toContain('needs 2 couriers')
  })

  it('refuses a rendezvous for a single vendor', () => {
    const attempt = planRendezvous(
      inputOf([vendor('a', 25.3, 51.53, 5)], [courier('c1', 25.29, 51.52), courier('c2', 25.3, 51.5)]),
    )

    expect(isPlan(attempt)).toBe(false)
    if (!isPlan(attempt)) expect(attempt.reason).toContain('one vendor')
  })

  it('refuses a rendezvous with only one courier', () => {
    const attempt = planRendezvous(
      inputOf([vendor('a', 25.3, 51.53, 5), vendor('b', 25.28, 51.5, 5)], [courier('c', 25.29, 51.52)]),
    )

    expect(isPlan(attempt)).toBe(false)
    if (!isPlan(attempt)) expect(attempt.reason).toContain('2 couriers')
  })

  it('refuses a rendezvous with nowhere safe to meet', () => {
    const base = inputOf([vendor('a', 25.3, 51.53, 5), vendor('b', 25.28, 51.5, 5)], [
      courier('c1', 25.29, 51.52),
      courier('c2', 25.3, 51.5),
    ])

    const attempt = planRendezvous({ ...base, meetingPoints: [] })

    expect(isPlan(attempt)).toBe(false)
    if (!isPlan(attempt)) expect(attempt.reason).toContain('meeting points')
  })
})

describe('plan shape', () => {
  it('delivers the whole basket in one arrival when consolidating', () => {
    const attempt = planSequential(
      inputOf([vendor('a', 25.3, 51.53, 5), vendor('b', 25.28, 51.5, 5)], [courier('c', 25.29, 51.52)]),
    )

    expect(isPlan(attempt)).toBe(true)
    if (!isPlan(attempt)) return
    const deliveries = attempt.legs.filter((leg) => leg.kind === 'deliver')
    expect(deliveries).toHaveLength(1)
    // Visit order is the planner's business; what matters is that one arrival
    // carries the whole basket.
    expect([...deliveries[0].cargo].sort()).toEqual(['a', 'b'])
  })

  it('moves custody exactly once at a rendezvous, and names both couriers', () => {
    const attempt = planRendezvous(
      inputOf([vendor('a', 25.42, 51.53, 8), vendor('b', 25.40, 51.55, 8)], [
        courier('c1', 25.42, 51.53),
        courier('c2', 25.40, 51.55),
      ]),
    )

    expect(isPlan(attempt)).toBe(true)
    if (!isPlan(attempt)) return
    expect(attempt.handovers).toHaveLength(1)

    const [handover] = attempt.handovers
    expect(handover.fromCourierId).not.toBe(handover.toCourierId)
    // The courier who continues is the one holding everything afterwards.
    const delivery = attempt.legs.find((leg) => leg.kind === 'deliver')
    expect(delivery?.courierId).toBe(handover.toCourierId)
    expect(delivery?.cargo.sort()).toEqual(['a', 'b'])
  })
})
