import { describe, expect, it } from 'vitest'
import { runFieldStudy, summarise } from './realVendors.ts'
import { sweep, winRates } from './sweep.ts'

const study = runFieldStudy(['ambient', 'hot'])

describe('real Doha vendor pairs on measured road times', () => {
  it('covers every pair of vendors to every customer area', () => {
    // 12 vendors give 66 pairs, across 6 customer areas and 2 temperatures.
    expect(study).toHaveLength(66 * 6 * 2)
  })

  it('finds that combining usually beats a courier per vendor', () => {
    const summary = summarise(study)

    expect(summary.consolidationWins).toBeGreaterThan(0.6)
    expect(summary.medianSavingShare).toBeGreaterThan(0.1)
  })

  it('settles on one courier touring both vendors far more often than a handover', () => {
    const summary = summarise(study)

    expect(summary.winRate.sequential).toBeGreaterThan(summary.winRate.rendezvous * 5)
  })

  it('still finds baskets where the handover is the best plan', () => {
    expect(study.filter((item) => item.winner === 'rendezvous').length).toBeGreaterThan(0)
  })

  it('pushes towards separate deliveries once the goods are hot', () => {
    const ambient = summarise(study.filter((item) => item.temperature === 'ambient'))
    const hot = summarise(study.filter((item) => item.temperature === 'hot'))

    expect(hot.winRate.separate).toBeGreaterThan(ambient.winRate.separate)
  })
})

describe('the controlled sweep and the field study disagree', () => {
  it('and the sampling explains it, not the planner', () => {
    const controlled = winRates(
      sweep({
        spreads: [0, 15, 30, 45, 60, 90, 120, 150, 180],
        skews: [0, 5, 10, 15, 20, 30],
        radii: [3, 8, 15],
        temperatures: ['ambient', 'hot'],
      }),
    )
    const field = summarise(study)

    // Sweeping spread uniformly puts half the cells beyond the angle where a
    // shared delivery can win at all. Real vendors are not spread uniformly
    // around a customer, so the controlled figure understates how often
    // combining pays in a real city — it answers a question about a geometry
    // that does not exist, which is what makes it useful for isolating causes
    // and useless as a headline.
    const controlledConsolidation = controlled.sequential + controlled.rendezvous

    expect(controlledConsolidation).toBeLessThan(0.5)
    expect(field.consolidationWins).toBeGreaterThan(0.6)
  })
})
