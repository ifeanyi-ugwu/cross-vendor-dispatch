/**
 * Splitting one delivery's cost between the vendors that shared it.
 *
 * The obvious rule — divide by the number of vendors — charges a vendor sitting
 * directly on the route the same as one that dragged the courier ten minutes
 * off it. The Shapley value instead bills each vendor its average marginal
 * contribution across every order in which it could have joined, which is the
 * standard answer to sharing the cost of a coalition and is exact for the
 * handful of vendors a basket ever spans.
 */

export type CoalitionCost = (vendorIds: string[]) => number

function key(vendorIds: string[]): string {
  return [...vendorIds].sort().join('|')
}

/** Memoises the planner, which is re-run once per subset. */
export function memoiseCost(costOf: CoalitionCost): CoalitionCost {
  const cache = new Map<string, number>()
  return (vendorIds) => {
    const id = key(vendorIds)
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    const value = costOf(vendorIds)
    cache.set(id, value)
    return value
  }
}

function subsetsExcluding(vendorIds: string[], excluded: string): string[][] {
  const others = vendorIds.filter((id) => id !== excluded)
  const subsets: string[][] = []
  for (let mask = 0; mask < 1 << others.length; mask += 1) {
    subsets.push(others.filter((_, index) => (mask >> index) & 1))
  }
  return subsets
}

function factorial(n: number): number {
  let result = 1
  for (let i = 2; i <= n; i += 1) result *= i
  return result
}

/**
 * Each vendor pays the average, over every order the vendors could be added in,
 * of the extra cost its arrival caused. The shares always sum to the joint
 * cost, and a vendor that adds nothing pays nothing.
 */
export function shapleyShares(
  vendorIds: string[],
  costOf: CoalitionCost,
): Record<string, number> {
  const n = vendorIds.length
  const cost = memoiseCost(costOf)
  const shares: Record<string, number> = {}

  for (const vendorId of vendorIds) {
    let share = 0
    for (const subset of subsetsExcluding(vendorIds, vendorId)) {
      const weight = (factorial(subset.length) * factorial(n - subset.length - 1)) / factorial(n)
      share += weight * (cost([...subset, vendorId]) - cost(subset))
    }
    shares[vendorId] = share
  }

  return shares
}

export function equalShares(vendorIds: string[], total: number): Record<string, number> {
  return Object.fromEntries(vendorIds.map((id) => [id, total / vendorIds.length]))
}

export function valueProportionalShares(
  values: Record<string, number>,
  total: number,
): Record<string, number> {
  const sum = Object.values(values).reduce((a, b) => a + b, 0)
  if (sum === 0) return equalShares(Object.keys(values), total)
  return Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, (value / sum) * total]),
  )
}

/**
 * Whether any group of vendors would have been better off breaking away and
 * delivering by themselves. An allocation outside the core is unstable: someone
 * is subsidising the others and can prove it.
 */
export function coreViolations(
  shares: Record<string, number>,
  costOf: CoalitionCost,
  tolerance = 1e-9,
): Array<{ coalition: string[]; charged: number; alone: number }> {
  const vendorIds = Object.keys(shares)
  const cost = memoiseCost(costOf)
  const violations: Array<{ coalition: string[]; charged: number; alone: number }> = []

  for (let mask = 1; mask < 1 << vendorIds.length; mask += 1) {
    const coalition = vendorIds.filter((_, index) => (mask >> index) & 1)
    const charged = coalition.reduce((sum, id) => sum + shares[id], 0)
    const alone = cost(coalition)
    if (charged > alone + tolerance) violations.push({ coalition, charged, alone })
  }

  return violations
}
