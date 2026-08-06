import { useMemo } from 'react'
import type { Basket, Courier, LatLng, Plan } from '../domain/types.ts'
import { fitViewport } from './projection.ts'

const COURIER_COLOURS = ['#2f6fdb', '#c2410c', '#0f766e', '#7c3aed', '#b91c1c']

type Props = {
  basket: Basket
  couriers: Courier[]
  plan: Plan | null
  width?: number
  height?: number
}

function colourFor(courierId: string, order: string[]): string {
  const index = order.indexOf(courierId)
  return COURIER_COLOURS[(index < 0 ? 0 : index) % COURIER_COLOURS.length]
}

export function PlanMap({ basket, couriers, plan, width = 640, height = 460 }: Props) {
  const involved = useMemo(
    () => (plan ? [...new Set(plan.legs.map((leg) => leg.courierId))] : []),
    [plan],
  )

  const viewport = useMemo(() => {
    const points: LatLng[] = [
      basket.customer,
      ...basket.orders.map((order) => order.vendor),
      ...couriers.filter((courier) => involved.includes(courier.id)),
      ...(plan?.handovers.map((handover) => handover.at) ?? []),
    ]
    return fitViewport(points, width, height)
  }, [basket, couriers, plan, involved, width, height])

  const customer = viewport.to(basket.customer)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', background: 'var(--map-bg)', borderRadius: 8 }}
      role="img"
      aria-label="Delivery plan"
    >
      <defs>
        {COURIER_COLOURS.map((colour, index) => (
          <marker
            key={colour}
            id={`arrow-${index}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colour} />
          </marker>
        ))}
      </defs>

      {plan?.legs.map((leg, index) => {
        const from = viewport.to(leg.from)
        const to = viewport.to(leg.to)
        const colour = colourFor(leg.courierId, involved)
        const arrowIndex = COURIER_COLOURS.indexOf(colour)
        return (
          <line
            key={`${leg.courierId}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={colour}
            strokeWidth={leg.kind === 'deliver' ? 3 : 2}
            // A transfer is the leg that only exists to converge, so it reads
            // differently from legs that collect or deliver.
            strokeDasharray={leg.kind === 'transfer' ? '6 4' : undefined}
            markerEnd={`url(#arrow-${arrowIndex < 0 ? 0 : arrowIndex})`}
            opacity={0.85}
          />
        )
      })}

      {basket.orders.map((order) => {
        const at = viewport.to(order.vendor)
        return (
          <g key={order.vendorId}>
            <rect
              x={at.x - 7}
              y={at.y - 7}
              width={14}
              height={14}
              rx={3}
              fill="var(--vendor-fill)"
              stroke="var(--vendor-stroke)"
              strokeWidth={2}
            />
            <text x={at.x} y={at.y - 13} textAnchor="middle" className="map-label">
              {order.vendor.label}
            </text>
            {order.vendor.schedulable && (
              <title>{`${order.vendor.label} — can be told when to start`}</title>
            )}
          </g>
        )
      })}

      {plan?.handovers.map((handover) => {
        const at = viewport.to(handover.at)
        return (
          <g key={`${handover.fromCourierId}-${handover.occursAt}`}>
            <circle
              cx={at.x}
              cy={at.y}
              r={11}
              fill="none"
              stroke="var(--handover-stroke)"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
            <text x={at.x} y={at.y + 26} textAnchor="middle" className="map-label">
              {handover.at.label}
            </text>
          </g>
        )
      })}

      {couriers
        .filter((courier) => involved.includes(courier.id))
        .map((courier) => {
          const at = viewport.to(courier)
          return (
            <circle
              key={courier.id}
              cx={at.x}
              cy={at.y}
              r={6}
              fill={colourFor(courier.id, involved)}
              stroke="var(--marker-ring)"
              strokeWidth={2}
            >
              <title>{`${courier.name} (${courier.vehicle})`}</title>
            </circle>
          )
        })}

      <g>
        <path
          d={`M ${customer.x} ${customer.y - 10} L ${customer.x + 9} ${customer.y + 6} L ${customer.x - 9} ${customer.y + 6} Z`}
          fill="var(--customer-fill)"
          stroke="var(--marker-ring)"
          strokeWidth={2}
        />
        <text x={customer.x} y={customer.y + 22} textAnchor="middle" className="map-label">
          {basket.customer.label}
        </text>
      </g>
    </svg>
  )
}
