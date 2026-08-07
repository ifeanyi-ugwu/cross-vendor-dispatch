/**
 * Asks a running OSRM for the driving time between every pair of fixed places
 * and writes the result to src/data/durations.json.
 *
 * Driven by build-routing-matrix.sh, which starts the server. Keys are rounded
 * coordinates rather than ids, so the lookup works for any point that happens
 * to coincide with a fixture without the planner needing to know about ids.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COURIERS, CUSTOMER_AREAS, MEETING_POINTS, VENDORS } from '../src/fixtures/doha.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OSRM = process.env.OSRM_URL ?? 'http://localhost:5010'

const places = [
  ...VENDORS.map((v) => ({ id: v.id, label: v.label, lat: v.lat, lng: v.lng, kind: 'vendor' })),
  ...MEETING_POINTS.map((m) => ({ id: m.id, label: m.label, lat: m.lat, lng: m.lng, kind: 'meeting' })),
  ...CUSTOMER_AREAS.map((c) => ({ id: c.id, label: c.label, lat: c.lat, lng: c.lng, kind: 'customer' })),
  ...COURIERS.map((c) => ({ id: c.id, label: c.name, lat: c.lat, lng: c.lng, kind: 'courier' })),
]

const key = (point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`
const coords = places.map((p) => `${p.lng},${p.lat}`).join(';')

const response = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration`)
if (!response.ok) throw new Error(`OSRM returned ${response.status}`)

const body = await response.json()
if (body.code !== 'Ok') throw new Error(`OSRM said ${body.code}: ${body.message ?? ''}`)

const durations = {}
let unreachable = 0
body.durations.forEach((row, from) => {
  row.forEach((seconds, to) => {
    if (from === to) return
    // OSRM returns null when no route exists, which for a road network inside
    // one city means a snapping failure worth knowing about rather than
    // silently treating as zero.
    if (seconds === null) {
      unreachable += 1
      return
    }
    durations[`${key(places[from])}|${key(places[to])}`] = Math.round(seconds)
  })
})

const straightLineComparison = () => {
  const samples = []
  for (const [pair, seconds] of Object.entries(durations)) {
    const [a, b] = pair.split('|')
    const [aLat, aLng] = a.split(',').map(Number)
    const [bLat, bLng] = b.split(',').map(Number)
    const R = 6371000
    const rad = (d) => (d * Math.PI) / 180
    const h =
      Math.sin(rad(bLat - aLat) / 2) ** 2 +
      Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2
    const metres = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
    if (metres > 500) samples.push(seconds / ((metres * 1.35) / 8.9))
  }
  samples.sort((x, y) => x - y)
  return samples[Math.floor(samples.length / 2)]
}

writeFileSync(
  join(ROOT, 'src', 'data', 'durations.json'),
  `${JSON.stringify(
    {
      profile: 'driving',
      source: 'OSRM over a Qatar crop of the Geofabrik Gulf extract',
      places: places.map(({ id, label, kind }) => ({ id, label, kind })),
      durations,
    },
    null,
    0,
  )}\n`,
)

console.log(`  places:     ${places.length}`)
console.log(`  pairs:      ${Object.keys(durations).length}`)
console.log(`  unreachable:${unreachable}`)
console.log(`  real vs straight-line estimate (median ratio): ${straightLineComparison().toFixed(2)}x`)
