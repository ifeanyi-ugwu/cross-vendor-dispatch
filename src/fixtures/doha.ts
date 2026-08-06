import type { Courier, MeetingPoint, Vendor } from '../domain/types.ts'

/**
 * Real districts, so distances and the shape of the city behave plausibly.
 *
 * `schedulable` marks who will cook to a given time. Kitchens working to order
 * generally will; a bakery on fixed batches and a shop picking off a shelf have
 * nothing to hold back, so their goods start ageing the moment they are ready.
 */
export const VENDORS: Vendor[] = [
  { id: 'v-westbay', label: 'West Bay Grill', lat: 25.3208, lng: 51.53, prepMinutes: 14, schedulable: true },
  { id: 'v-msheireb', label: 'Msheireb Bakery', lat: 25.2867, lng: 51.5262, prepMinutes: 8, schedulable: false },
  { id: 'v-souq', label: 'Souq Waqif Spices', lat: 25.2867, lng: 51.5333, prepMinutes: 5, schedulable: false },
  { id: 'v-sadd', label: 'Al Sadd Pharmacy', lat: 25.276, lng: 51.509, prepMinutes: 6, schedulable: false },
  { id: 'v-pearl', label: 'The Pearl Patisserie', lat: 25.3697, lng: 51.55, prepMinutes: 18, schedulable: true },
  { id: 'v-katara', label: 'Katara Seafood', lat: 25.3594, lng: 51.5262, prepMinutes: 22, schedulable: true },
  { id: 'v-education', label: 'Education City Books', lat: 25.315, lng: 51.437, prepMinutes: 4, schedulable: false },
  { id: 'v-lusail', label: 'Lusail Marina Deli', lat: 25.42, lng: 51.53, prepMinutes: 11, schedulable: true },
  { id: 'v-wakrah', label: 'Al Wakrah Fishmonger', lat: 25.1715, lng: 51.6034, prepMinutes: 9, schedulable: false },
  { id: 'v-aspire', label: 'Aspire Sports Shop', lat: 25.265, lng: 51.445, prepMinutes: 3, schedulable: false },
  { id: 'v-villaggio', label: 'Villaggio Electronics', lat: 25.2597, lng: 51.4437, prepMinutes: 7, schedulable: false },
  { id: 'v-rayyan', label: 'Al Rayyan Butcher', lat: 25.2919, lng: 51.4244, prepMinutes: 12, schedulable: true },
]

/**
 * Curated by hand rather than generated. A meeting point has to be somewhere
 * two couriers can legally stop, park, see each other and move goods between
 * vehicles — which rules out most of the coordinates an optimiser would pick.
 */
export const MEETING_POINTS: MeetingPoint[] = [
  { id: 'm-corniche', label: 'Corniche car park', lat: 25.299, lng: 51.533, note: 'Wide lay-by, always staffed' },
  { id: 'm-msheireb-hub', label: 'Msheireb metro forecourt', lat: 25.2884, lng: 51.5222, note: 'Metered bays, covered' },
  { id: 'm-cityCenter', label: 'City Center Mall service road', lat: 25.3175, lng: 51.5062, note: 'Loading bay, 15 min limit' },
  { id: 'm-landmark', label: 'Landmark Mall forecourt', lat: 25.3403, lng: 51.4463, note: 'Large open car park' },
  { id: 'm-aspire-park', label: 'Aspire Park north gate', lat: 25.2611, lng: 51.4444, note: 'Free parking, easy landmark' },
  { id: 'm-ramada', label: 'Ramada Junction petrol station', lat: 25.2716, lng: 51.5117, note: 'Forecourt, open 24h' },
  { id: 'm-industrial', label: 'Salwa Road service station', lat: 25.2492, lng: 51.4675, note: 'Forecourt, easy U-turn' },
  { id: 'm-pearl-gate', label: 'The Pearl entrance plaza', lat: 25.3646, lng: 51.5443, note: 'Security gate lay-by' },
  { id: 'm-katara-gate', label: 'Katara south car park', lat: 25.3556, lng: 51.5238, note: 'Large surface car park' },
  { id: 'm-lusail-gate', label: 'Lusail Boulevard car park', lat: 25.4138, lng: 51.5277, note: 'Multi-storey, ground level' },
  { id: 'm-airport-road', label: 'Airport Road petrol station', lat: 25.2622, lng: 51.5652, note: 'Forecourt on the main artery' },
  { id: 'm-wakrah-gate', label: 'Al Wakrah Souq car park', lat: 25.1762, lng: 51.6008, note: 'Free parking near the corniche' },
  { id: 'm-rayyan-stadium', label: 'Al Rayyan stadium car park', lat: 25.2896, lng: 51.4318, note: 'Empty outside match days' },
  { id: 'm-education-gate', label: 'Education City north gate', lat: 25.3181, lng: 51.4415, note: 'Visitor drop-off loop' },
]

export const COURIERS: Courier[] = [
  { id: 'c-1', name: 'Adeel Rahman', label: 'Adeel Rahman', vehicle: 'car', lat: 25.3, lng: 51.52, availableAt: 0 },
  { id: 'c-2', name: 'Bilal Haq', label: 'Bilal Haq', vehicle: 'bike', lat: 25.28, lng: 51.5, availableAt: 0 },
  { id: 'c-3', name: 'Chandra Pillai', label: 'Chandra Pillai', vehicle: 'car', lat: 25.35, lng: 51.54, availableAt: 0 },
  { id: 'c-4', name: 'Dmitri Volkov', label: 'Dmitri Volkov', vehicle: 'van', lat: 25.26, lng: 51.45, availableAt: 0 },
  { id: 'c-5', name: 'Emeka Obi', label: 'Emeka Obi', vehicle: 'car', lat: 25.39, lng: 51.53, availableAt: 0 },
  { id: 'c-6', name: 'Farid Nassar', label: 'Farid Nassar', vehicle: 'bike', lat: 25.29, lng: 51.53, availableAt: 0 },
]

export const CUSTOMER_AREAS = [
  { id: 'cust-westbay', label: 'West Bay tower', lat: 25.3234, lng: 51.5285 },
  { id: 'cust-pearl', label: 'The Pearl apartment', lat: 25.3688, lng: 51.5462 },
  { id: 'cust-sadd', label: 'Al Sadd villa', lat: 25.2777, lng: 51.5061 },
  { id: 'cust-aspire', label: 'Aspire Zone flat', lat: 25.2639, lng: 51.4472 },
  { id: 'cust-lusail', label: 'Lusail residence', lat: 25.4177, lng: 51.5311 },
  { id: 'cust-wakrah', label: 'Al Wakrah house', lat: 25.1738, lng: 51.6011 },
]
