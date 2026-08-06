import { project } from '../domain/geo.ts'
import type { LatLng } from '../domain/types.ts'

export type Viewport = {
  /** Maps a coordinate onto the SVG's user space. */
  to(point: LatLng): { x: number; y: number }
  width: number
  height: number
}

/**
 * Fits a set of coordinates into a fixed SVG box, preserving the city's
 * proportions. A single scale is used for both axes so the map is not stretched
 * to fill the box, which would distort every distance the plan is arguing
 * about.
 */
export function fitViewport(
  points: LatLng[],
  width: number,
  height: number,
  padding = 36,
): Viewport {
  const origin = points[0] ?? { lat: 0, lng: 0 }
  const flat = points.map((point) => project(point, origin))

  const xs = flat.map((p) => p.x)
  const ys = flat.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const spanX = maxX - minX || 1e-6
  const spanY = maxY - minY || 1e-6
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)

  // Centre whichever axis has slack, so the map sits in the middle of the box.
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  return {
    width,
    height,
    to(point) {
      const flatPoint = project(point, origin)
      return {
        x: (flatPoint.x - minX) * scale + offsetX,
        y: (flatPoint.y - minY) * scale + offsetY,
      }
    },
  }
}
