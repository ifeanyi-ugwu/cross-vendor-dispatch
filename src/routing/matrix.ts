import table from '../data/durations.json' with { type: 'json' }
import { matrixEta, straightLineEta, type EtaProvider } from './eta.ts'

/**
 * Driving times measured on the real road network, built offline by
 * `tools/build-routing-matrix.sh` and committed. The browser reads the table
 * directly, so nothing at run time depends on a routing service.
 *
 * It covers only the fixed places — vendors, meeting points, customer areas and
 * courier stations. Anything else falls back to the straight-line estimate,
 * which is the right behaviour for synthetic geometry that no real road serves.
 */
const keyOf = (point: { lat: number; lng: number }) =>
  `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`

export const routedEta: EtaProvider = matrixEta(
  table.durations as Record<string, number>,
  keyOf,
  straightLineEta,
)

export const routingTable = table
