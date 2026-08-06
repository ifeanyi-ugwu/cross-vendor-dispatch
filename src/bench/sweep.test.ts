import { describe, expect, it } from 'vitest'
import { sweep, sweepCell, winRates } from './sweep.ts'

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
