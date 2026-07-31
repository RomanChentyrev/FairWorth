const { z } = require('zod');

const identifier = z.string().trim().min(1).max(200);
const shortText = z.string().trim().max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must use YYYY-MM-DD');
const currency = z.string().trim().regex(/^[A-Z]{3}$/, 'must be an uppercase three-letter currency code');
const optionalText = maximum => z.string().trim().max(maximum).optional();
const stringList = (maximumItems = 30, maximumLength = 100) => z.array(z.string().trim().min(1).max(maximumLength)).max(maximumItems);
const jsonValue = z.lazy(() => z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue).max(100), z.record(z.string().max(100), jsonValue)]));
const boundedObject = z.record(z.string().max(100), jsonValue).refine(value => JSON.stringify(value).length <= 20000, 'object is too large');
const httpUrl = z.string().trim().url().max(4096).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'must use http or https');
const atLeastOne = (value, context) => {
  if (!Object.values(value).some(item => item !== undefined)) context.addIssue({ code: 'custom', message: 'at least one field is required' });
};

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: optionalText(50),
  city: optionalText(120),
  country: optionalText(120),
  bio: optionalText(2000),
  website: z.union([z.literal(''), httpUrl.max(2048)]).optional(),
}).strict().superRefine(atLeastOne);

const preferencesSchema = z.object({
  hotel_stars: z.array(z.enum(['1', '2', '3', '4', '5'])).max(5).optional(),
  room_type: stringList(20, 60).optional(),
  room_view: stringList(20, 60).optional(),
  hotel_amenities: stringList(50, 100).optional(),
  required_hotel_amenities: stringList(50, 100).optional(),
  flight_type: optionalText(40),
  seat_class: optionalText(40),
  seat_position: optionalText(40),
  preferred_airlines: stringList(50, 120).optional(),
  max_stops: z.number().int().min(0).max(5).optional(),
  travel_style: stringList(30, 100).optional(),
  budget_level: optionalText(40),
  budget_per_night_max: z.number().finite().min(1).max(1000000).optional(),
  noise_sensitivity: z.number().int().min(0).max(100).optional(),
  favorite_destinations: stringList(50, 120).optional(),
  avoid_destinations: stringList(50, 120).optional(),
  alert_price_drop: z.boolean().optional(),
  alert_price_rise: z.boolean().optional(),
  alert_booking_reminder: z.boolean().optional(),
  alert_weekly_insights: z.boolean().optional(),
  alert_destination_deals: z.boolean().optional(),
}).strict().superRefine(atLeastOne);

const interactionSchema = z.object({
  event_type: z.enum(['impression', 'view', 'revisit', 'dwell_time', 'gallery_view', 'rooms_open', 'trip_add', 'trip_remove', 'compare_add', 'compare_remove', 'bookmark_add', 'bookmark_remove', 'checkout_started', 'booking_intent', 'booking', 'booking_completed', 'provider_click', 'preference_changed', 'hide']),
  hotel_id: identifier.nullish(),
  hotel_ids: z.array(identifier).min(1).max(100).optional(),
  context: boundedObject.default({}),
  session_id: z.string().trim().max(200).nullish(),
  event_id: z.string().trim().max(500).nullish(),
}).strict().refine(value => !(value.hotel_id && value.hotel_ids), { message: 'use hotel_id or hotel_ids, not both', path: ['hotel_ids'] });

const tripItemSchema = z.object({
  type: z.enum(['hotel', 'flight', 'transfer', 'other']),
  provider: optionalText(120),
  external_id: optionalText(200),
  booking_status: z.enum(['planned', 'booking_started', 'booked', 'completed', 'cancelled']).optional(),
  departure_at: z.string().datetime({ offset: true }).optional(),
  check_in_at: z.string().datetime({ offset: true }).optional(),
  metadata: boundedObject.default({}),
}).strict();

const tripCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  destination: shortText.optional(),
  start_date: date,
  end_date: date.nullish(),
  reminder_enabled: z.boolean().optional(),
  items: z.array(tripItemSchema).max(10).default([]),
}).strict();

const tripUpdateSchema = z.object({
  reminder_enabled: z.boolean().optional(),
  status: z.enum(['planned', 'booking_started', 'booked', 'completed', 'cancelled']).optional(),
}).strict().superRefine(atLeastOne);

const partnerClickSchema = z.object({
  hotel_id: identifier.nullish(),
  provider: optionalText(120),
  destination_url: httpUrl,
  amount: z.number().finite().positive().max(100000000).nullish(),
  currency: currency.nullish(),
  metadata: boundedObject.default({}),
}).strict();

const partnerPostbackSchema = z.object({
  event_id: z.string().min(1).max(200),
  click_id: z.string().min(1).max(200),
  event_type: z.literal('booking_completed'),
  booking_reference: z.string().max(200).optional(),
  amount: z.number().finite().nonnegative().max(100000000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be an uppercase three-letter currency code').optional(),
}).passthrough();

const travelVisitSchema = z.object({
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 country code'),
  country_name: z.string().trim().min(2).max(120),
  city_name: z.string().trim().min(1).max(120),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  visited_at: date.nullish(),
}).strict();

const demoHotelSchema = z.object({
  id: identifier, name: z.string().trim().min(1).max(240), city: optionalText(120),
  checkIn: date, checkOut: date, nights: z.number().int().min(1).max(90),
  totalPrice: z.number().finite().nonnegative().max(100000000),
}).strict();

const demoFlightSchema = z.object({
  flightId: identifier, title: z.string().trim().min(1).max(240),
  originCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  destinationCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  date, departureTime: optionalText(20), arrivalTime: optionalText(20),
  provider: optionalText(120), cabinClass: optionalText(40),
  passengers: z.number().int().min(1).max(9),
  totalPrice: z.number().finite().nonnegative().max(100000000),
}).strict();

const demoTravelerSchema = z.object({
  first_name: z.string().trim().min(1).max(80), last_name: z.string().trim().min(1).max(80),
  birth_date: date, gender: z.enum(['female', 'male', 'unspecified']),
  nationality: z.string().trim().min(2).max(80),
  document_type: z.enum(['passport', 'national_id']),
  document_number: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9 -]+$/),
  document_expiry: date,
}).strict();

const demoBookingSchema = z.object({
  currency: z.literal('USD'),
  hotel: demoHotelSchema,
  flights: z.array(demoFlightSchema).min(1).max(2),
  contact_email: z.string().trim().email().max(254),
  contact_phone: z.string().trim().min(5).max(50),
  travelers: z.array(demoTravelerSchema).min(1).max(9),
  special_requests: optionalText(1000),
  accept_demo_terms: z.literal(true),
}).strict().superRefine((value, context) => {
  const passengers = Math.max(...value.flights.map(flight => flight.passengers));
  if (value.travelers.length !== passengers) context.addIssue({ code: 'custom', path: ['travelers'], message: `must contain exactly ${passengers} travelers` });
  if (value.hotel.checkOut <= value.hotel.checkIn) context.addIssue({ code: 'custom', path: ['hotel', 'checkOut'], message: 'must be after check-in' });
  const today = new Date().toISOString().slice(0, 10);
  value.travelers.forEach((traveler, index) => {
    if (traveler.birth_date >= today) context.addIssue({ code: 'custom', path: ['travelers', index, 'birth_date'], message: 'must be in the past' });
    if (traveler.document_expiry <= today) context.addIssue({ code: 'custom', path: ['travelers', index, 'document_expiry'], message: 'must be in the future' });
  });
});

module.exports = { profileSchema, preferencesSchema, interactionSchema, tripCreateSchema, tripUpdateSchema, partnerClickSchema, partnerPostbackSchema, travelVisitSchema, demoBookingSchema };
