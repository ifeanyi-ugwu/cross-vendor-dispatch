import { describe, expect, it } from 'vitest'
import {
  coreViolations,
  equalShares,
  shapleyShares,
  valueProportionalShares,
  type CoalitionCost,
} from './allocate.ts'

const sum = (shares: Record<string, number>) =>
  Object.values(shares).reduce((a, b) => a + b, 0)

/**
 * Three vendors. A and B sit beside each other, C is out on its own. Serving
 * A and B together costs barely more than either alone; adding C always costs
 * a further 10 whoever it joins.
 */
const costOf: CoalitionCost = (vendorIds) => {
  const has = (id: string) => vendorIds.includes(id)
  if (vendorIds.length === 0) return 0
  const base = has('a') || has('b') ? 20 : 0
  const both = has('a') && has('b') ? 2 : 0
  const detour = has('c') ? (base > 0 ? 10 : 18) : 0
  return base + both + detour
}

describe('shapleyShares', () => {
  it('divides exactly the joint cost, with nothing left over', () => {
    const shares = shapleyShares(['a', 'b', 'c'], costOf)

    expect(sum(shares)).toBeCloseTo(costOf(['a', 'b', 'c']), 10)
  })

  it('charges two interchangeable vendors the same', () => {
    // A and B enter this cost function symmetrically.
    const shares = shapleyShares(['a', 'b', 'c'], costOf)

    expect(shares.a).toBeCloseTo(shares.b, 10)
  })

  it('charges nothing to a vendor that adds no cost anywhere', () => {
    const freeRider: CoalitionCost = (ids) => (ids.some((id) => id !== 'z') ? 30 : 0)

    const shares = shapleyShares(['a', 'b', 'z'], freeRider)

    expect(shares.z).toBeCloseTo(0, 10)
    expect(sum(shares)).toBeCloseTo(30, 10)
  })

  it('bills the vendor that forced the detour more than the ones on the route', () => {
    const shares = shapleyShares(['a', 'b', 'c'], costOf)

    expect(shares.c).toBeGreaterThan(shares.a)
    expect(shares.c).toBeGreaterThan(shares.b)
  })

  it('lands inside the core, so no group is subsidising the rest', () => {
    const shares = shapleyShares(['a', 'b', 'c'], costOf)

    expect(coreViolations(shares, costOf)).toEqual([])
  })

  it('reruns the planner once per distinct coalition, not once per ordering', () => {
    const seen: string[][] = []
    const counted: CoalitionCost = (ids) => {
      seen.push(ids)
      return ids.length * 10
    }

    shapleyShares(['a', 'b', 'c'], counted)

    // Eight subsets exist for three vendors; the memo means none is planned twice.
    expect(new Set(seen.map((ids) => [...ids].sort().join('|'))).size).toBe(8)
    expect(seen).toHaveLength(8)
  })
})

describe('naive rules, for contrast', () => {
  it('equal split ignores who caused the cost', () => {
    const equal = equalShares(['a', 'b', 'c'], costOf(['a', 'b', 'c']))
    const fair = shapleyShares(['a', 'b', 'c'], costOf)

    expect(equal.c).toBeLessThan(fair.c)
    // The vendors on the route make up the difference.
    expect(equal.a).toBeGreaterThan(fair.a)
  })

  it('value-proportional splits can leave a coalition worse off than going alone', () => {
    // C is cheap goods but an expensive detour; billing by basket value
    // undercharges it and overcharges the others.
    const byValue = valueProportionalShares({ a: 200, b: 200, c: 20 }, costOf(['a', 'b', 'c']))

    expect(coreViolations(byValue, costOf).length).toBeGreaterThan(0)
  })
})
