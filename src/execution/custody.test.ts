import { describe, expect, it } from 'vitest'
import type { VendorOrder } from '../domain/types.ts'
import { cargoOf, custodyViolations, holderOf, type CustodyEvent } from './custody.ts'

const order = (vendorId: string): VendorOrder => ({
  vendorId,
  vendor: { id: vendorId, label: vendorId, lat: 25.3, lng: 51.5, prepMinutes: 5, schedulable: true },
  value: 100,
  temperature: 'ambient',
  readyAt: 0,
})

const orders = [order('a'), order('b')]

describe('holderOf', () => {
  it('starts at the vendor', () => {
    expect(holderOf([], 'a')).toEqual({ kind: 'vendor' })
  })

  it('follows collection and delivery', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 9, type: 'delivered', vendorId: 'a', courierId: 'c1' },
    ]

    expect(holderOf(events, 'a', 5)).toEqual({ kind: 'courier', courierId: 'c1' })
    expect(holderOf(events, 'a')).toEqual({ kind: 'customer' })
  })

  it('moves custody only once the receiving courier accepts', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 5, type: 'handover:offered', vendorId: 'a', from: 'c1', to: 'c2' },
    ]

    // Offered and not accepted: whoever physically has the goods still has them.
    // A transfer interrupted halfway must not leave the parcel with nobody.
    expect(holderOf(events, 'a')).toEqual({ kind: 'courier', courierId: 'c1' })

    events.push({ at: 6, type: 'handover:accepted', vendorId: 'a', from: 'c1', to: 'c2' })
    expect(holderOf(events, 'a')).toEqual({ kind: 'courier', courierId: 'c2' })
  })

  it('answers who held it at a given moment, not only who holds it now', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 5, type: 'handover:offered', vendorId: 'a', from: 'c1', to: 'c2' },
      { at: 6, type: 'handover:accepted', vendorId: 'a', from: 'c1', to: 'c2' },
      { at: 20, type: 'delivered', vendorId: 'a', courierId: 'c2' },
    ]

    // The question a dispute actually asks.
    expect(holderOf(events, 'a', 3)).toEqual({ kind: 'courier', courierId: 'c1' })
    expect(holderOf(events, 'a', 10)).toEqual({ kind: 'courier', courierId: 'c2' })
  })
})

describe('cargoOf', () => {
  it('lists what a courier is carrying right now', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 2, type: 'collected', vendorId: 'b', courierId: 'c2' },
      { at: 6, type: 'handover:offered', vendorId: 'b', from: 'c2', to: 'c1' },
      { at: 7, type: 'handover:accepted', vendorId: 'b', from: 'c2', to: 'c1' },
    ]

    expect(cargoOf(events, 'c1', ['a', 'b'])).toEqual(['a', 'b'])
    expect(cargoOf(events, 'c2', ['a', 'b'])).toEqual([])
  })
})

describe('custodyViolations', () => {
  it('passes a well-formed history', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 2, type: 'collected', vendorId: 'b', courierId: 'c2' },
      { at: 6, type: 'handover:offered', vendorId: 'b', from: 'c2', to: 'c1' },
      { at: 7, type: 'handover:accepted', vendorId: 'b', from: 'c2', to: 'c1' },
      { at: 20, type: 'delivered', vendorId: 'a', courierId: 'c1' },
      { at: 20, type: 'delivered', vendorId: 'b', courierId: 'c1' },
    ]

    expect(custodyViolations(events, orders)).toEqual([])
  })

  it('catches a courier handing over goods they are not holding', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 5, type: 'handover:offered', vendorId: 'a', from: 'c3', to: 'c2' },
      { at: 6, type: 'handover:accepted', vendorId: 'a', from: 'c3', to: 'c2' },
    ]

    expect(custodyViolations(events, orders).map((v) => v.rule)).toContain(
      'handover offered by a courier not holding the goods',
    )
  })

  it('catches an accepted handover nobody offered', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 6, type: 'handover:accepted', vendorId: 'a', from: 'c1', to: 'c2' },
    ]

    expect(custodyViolations(events, orders).map((v) => v.rule)).toContain(
      'handover accepted that was never offered',
    )
  })

  it('catches delivery by a courier who is not carrying it', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 9, type: 'delivered', vendorId: 'a', courierId: 'c2' },
    ]

    expect(custodyViolations(events, orders).map((v) => v.rule)).toContain(
      'delivered by a courier not holding the goods',
    )
  })

  it('catches goods collected twice', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'a', courierId: 'c1' },
      { at: 4, type: 'collected', vendorId: 'a', courierId: 'c2' },
    ]

    expect(custodyViolations(events, orders).map((v) => v.rule)).toContain(
      'collected goods that had already left the vendor',
    )
  })

  it('catches an event for something not in the basket', () => {
    const events: CustodyEvent[] = [
      { at: 1, type: 'collected', vendorId: 'ghost', courierId: 'c1' },
    ]

    expect(custodyViolations(events, orders).map((v) => v.rule)).toContain(
      'event for an order that is not in the basket',
    )
  })
})
