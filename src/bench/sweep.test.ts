import { describe, expect, it } from 'vitest'
import { haversineMetres } from '../domain/geo.ts'
import { contestedShare, DEFAULT_ORIGIN, sweep, sweepCell, winRates } from './sweep.ts'

/**
 * The claims the project exists to make. Each is a statement about when
 * consolidation pays, so if the planner changes shape these fail loudly rather
 * than quietly rewriting the conclusion.
 */
describe('where each strategy wins', () => {
  it('never favours a handover when the vendors are on opposite sides of the customer', () => {
    // Nothing lies on both couriers' way to the door, so one must double back.
    for (const skew of [0, 10, 20]) {
      for (const radiusKm of [3, 8, 15]) {
        expect(sweepCell(180, skew, radiusKm, 'ambient').winner).not.toBe('rendezvous')
      }
    }
  })

  it('favours a handover when vendors sit close together and finish together', () => {
    expect(sweepCell(0, 0, 8, 'ambient').winner).toBe('rendezvous')
    expect(sweepCell(30, 0, 15, 'ambient').winner).toBe('rendezvous')
  })

  it('keeps the handover viable even when the kitchens are far out of step', () => {
    // Skew stops deciding this once the earlier courier simply starts later.
    // The wait is removed rather than moved from the vendor counter to the
    // roadside, so a thirty-minute gap no longer rules a handover out.
    expect(sweepCell(0, 0, 8, 'ambient').winner).toBe('rendezvous')
    expect(sweepCell(0, 30, 8, 'ambient').winner).toBe('rendezvous')
  })

  it('sends one courier to both vendors when they are close and mildly out of step', () => {
    expect(sweepCell(0, 5, 8, 'ambient').winner).toBe('sequential')
  })

  it('shrinks every consolidation regime once the goods are hot', () => {
    const ambient = sweep({
      spreads: [0, 15, 30, 45, 60, 90, 120, 150, 180],
      skews: [0, 5, 10, 15, 20, 30],
      radii: [3, 8, 15],
      temperatures: ['ambient'],
    })
    const hot = sweep({
      spreads: [0, 15, 30, 45, 60, 90, 120, 150, 180],
      skews: [0, 5, 10, 15, 20, 30],
      radii: [3, 8, 15],
      temperatures: ['hot'],
    })

    const consolidated = (rates: ReturnType<typeof winRates>) => rates.sequential + rates.rendezvous

    expect(consolidated(winRates(hot))).toBeLessThan(consolidated(winRates(ambient)))
  })

  it('admits when two strategies are too close to tell apart', () => {
    const cells = sweep({
      spreads: [0, 15, 30, 45, 60, 90, 120, 150, 180],
      skews: [0, 5, 10, 15, 20, 30],
      radii: [3, 8, 15],
      temperatures: ['ambient', 'hot'],
    })

    // Roughly a quarter of the grid is decided by less than the model's own
    // accuracy. Reporting a winner there would be inventing a preference, and
    // it is what made the map look like it was flipping at random.
    expect(contestedShare(cells)).toBeGreaterThan(0.15)
    expect(contestedShare(cells)).toBeLessThan(0.45)
  })

  it('is decisive where the geometry decides it', () => {
    // Vendors on opposite sides of the customer is not a close call.
    const opposed = sweepCell(180, 0, 15, 'ambient')

    expect(opposed.tied).toEqual(['separate'])
  })

  it('leaves separate deliveries the right answer most of the time', () => {
    const rates = winRates(
      sweep({
        spreads: [0, 15, 30, 45, 60, 90, 120, 150, 180],
        skews: [0, 5, 10, 15, 20, 30],
        radii: [3, 8, 15],
        temperatures: ['ambient', 'hot'],
      }),
    )

    // The honest headline: consolidation is a niche, not a default. A planner
    // that always consolidated would be wrong far more often than right.
    expect(rates.separate).toBeGreaterThan(0.5)
    expect(rates.rendezvous).toBeGreaterThan(0)
    expect(rates.rendezvous).toBeLessThan(0.3)
  })
})

describe('nothing here is specific to Doha', () => {
  const elsewhere = [
    { id: 'c', label: 'Oslo', lat: 59.913, lng: 10.752 },
    { id: 'c', label: 'Nairobi', lat: -1.286, lng: 36.817 },
    { id: 'c', label: 'Quito', lat: -0.18, lng: -78.467 },
  ]

  it('places vendors the intended distance apart at any latitude', () => {
    // A degree of longitude is a tenth shorter at Doha than at the equator and
    // half as long near Oslo. Fixing that conversion rather than taking it at
    // the origin turns the circle into an ellipse, and the sweep then reports
    // an angle it never set.
    for (const origin of [DEFAULT_ORIGIN, ...elsewhere]) {
      const { vendorPositions: [a, b] } = sweepCell(90, 0, 10, 'ambient', false, origin)

      expect(haversineMetres(origin, a) / 1000).toBeCloseTo(10, 0)
      expect(haversineMetres(origin, b) / 1000).toBeCloseTo(10, 0)
      // Two points 90 degrees apart on a circle of radius r lie r*sqrt(2) apart.
      expect(haversineMetres(a, b) / 1000).toBeCloseTo(10 * Math.SQRT2, 0)
    }
  })

  it('reaches the same verdict on the same geometry anywhere', () => {
    // Straight-line estimates depend on distance, not position, so a shape
    // should plan identically wherever it is put down.
    for (const origin of elsewhere) {
      expect(sweepCell(180, 0, 15, 'ambient', false, origin).winner).toBe('separate')
      expect(sweepCell(0, 0, 8, 'ambient', false, origin).winner).toBe(
        sweepCell(0, 0, 8, 'ambient', false, DEFAULT_ORIGIN).winner,
      )
    }
  })
})
