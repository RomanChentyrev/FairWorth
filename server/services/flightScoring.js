const FLIGHT_SCORE_VERSION = '1.0.0';

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = value => Math.round(clamp(value));
const finitePositive = value => Number.isFinite(Number(value)) && Number(value) > 0;

function parseList(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function median(values) {
  const sorted = values.filter(finitePositive).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function knownStops(ticket) {
  const value = ticket.transfers ?? ticket.stops ?? (ticket.direct === true ? 0 : null);
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

function knownDuration(ticket) {
  const value = ticket.duration_to ?? ticket.duration;
  return finitePositive(value) ? Number(value) : null;
}

function ticketCabin(ticket) {
  const value = ticket.cabin_class ?? ticket.cabin ?? ticket.trip_class_name;
  return value ? String(value).toLowerCase() : null;
}

function level(value) {
  if (value >= 80) return 'high';
  if (value >= 55) return 'medium';
  return 'low';
}

function componentAverage(components) {
  const applicable = components.filter(item => item.score !== null && item.score !== undefined);
  const weight = applicable.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return null;
  return applicable.reduce((sum, item) => sum + item.score * item.weight, 0) / weight;
}

function priceValueScore(price, benchmark) {
  if (!finitePositive(price) || !finitePositive(benchmark)) return null;
  const ratio = price / benchmark;
  if (ratio <= 0.7) return 100;
  if (ratio <= 1) return 100 - ((ratio - 0.7) / 0.3) * 18;
  if (ratio <= 1.5) return 82 - ((ratio - 1) / 0.5) * 37;
  return clamp(45 - (ratio - 1.5) * 25, 20, 45);
}

function durationScore(duration, baseline) {
  if (!finitePositive(duration) || !finitePositive(baseline)) return null;
  const ratio = Math.max(1, duration / baseline);
  return clamp(100 - (ratio - 1) * 48, 30, 100);
}

function stopsScore(stops, travelStyle) {
  if (stops === null) return null;
  const familyOrBusiness = travelStyle.includes('family') || travelStyle.includes('business');
  const penalties = familyOrBusiness ? [0, 30, 52, 65] : [0, 22, 42, 57];
  return clamp(100 - penalties[Math.min(stops, 3)], 30, 100);
}

function scheduleScore(ticket, travelStyle) {
  if (!ticket.departure_at) return null;
  const match = String(ticket.departure_at).match(/T(\d{2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  const business = travelStyle.includes('business');
  if (hour >= 7 && hour <= 20) return 100;
  if (hour >= 5 && hour <= 23) return business ? 72 : 82;
  return business ? 48 : 62;
}

function seatingScore(ticket, passengers) {
  if (passengers <= 1) return 100;
  const blocks = Array.isArray(ticket.seat_blocks)
    ? ticket.seat_blocks.map(Number).filter(value => Number.isFinite(value) && value > 0)
    : String(ticket.seat_layout || '').split(/[-x]/i).map(Number).filter(value => Number.isFinite(value) && value > 0);
  const abreast = Number(ticket.seats_abreast || ticket.aircraft_seats_abreast || 0);
  if (!blocks.length && abreast > 0) blocks.push(abreast);
  if (!blocks.length) return null;
  if (blocks.some(size => size === passengers)) return 100;
  if (blocks.some(size => size > passengers)) return passengers === 2 ? 72 : 80;
  const rowsNeeded = Math.ceil(passengers / Math.max(...blocks));
  return clamp(82 - (rowsNeeded - 1) * 18, 40, 82);
}

function fareConfidence(ticket, context) {
  let score = 62; // Travelpayouts Data API fares are indicative cached observations, not booking quotes.
  const unknown = ['confirmed_availability', 'seat_inventory'];
  if (ticket.source === 'price_calendar') score -= 15;
  if (ticket.fare_cache_status === 'local_cache') score -= 5;
  if (ticket.is_alternative_date) score -= 8;
  if (!ticket.link) { score -= 10; unknown.push('booking_link'); }
  if (!ticket.expires_at) { score -= 8; unknown.push('fare_expiry'); }
  if (ticket.taxes_included !== true) { score -= ticket.taxes_included === false ? 18 : 12; unknown.push('taxes_and_fees'); }
  if (ticket.baggage_included === undefined) { score -= 8; unknown.push('baggage'); }
  if (ticket.refundable === undefined) { score -= 6; unknown.push('refundability'); }
  if (!ticketCabin(ticket)) { score -= 8; unknown.push('confirmed_cabin'); }
  if (!ticket.price_for_passengers && context.passengers > 1) { score -= 8; unknown.push('party_price_confirmation'); }
  const observedAt = ticket.fare_observed_at ? new Date(ticket.fare_observed_at) : null;
  const ageHours = observedAt && !Number.isNaN(observedAt.getTime()) ? Math.max(0, (Date.now() - observedAt.getTime()) / 3600000) : null;
  if (ageHours === null) { score -= 8; unknown.push('fare_observed_at'); }
  else if (ageHours > 24) score -= 18;
  else if (ageHours > 6) score -= 10;
  else if (ageHours > 1) score -= 5;
  return { score: round(score), unknown };
}

function contextWeights(travelStyle, tripDays, budgetLevel) {
  if (budgetLevel === 'budget') return { value: 42, itinerary: 25, preferences: 20, schedule: 13 };
  if (travelStyle.includes('business')) return { value: 20, itinerary: 35, preferences: 25, schedule: 20 };
  if (travelStyle.includes('family')) return { value: 25, itinerary: 35, preferences: 25, schedule: 15 };
  if (tripDays !== null && tripDays <= 3) return { value: 22, itinerary: 38, preferences: 25, schedule: 15 };
  return { value: 30, itinerary: 30, preferences: 25, schedule: 15 };
}

function buildBenchmarks(tickets, requestedCabin = null) {
  const exact = tickets.filter(ticket => !ticket.is_alternative_date);
  const datedSource = exact.length ? exact : tickets;
  const cabinSource = requestedCabin
    ? datedSource.filter(ticket => ticketCabin(ticket) === requestedCabin)
    : [];
  const source = cabinSource.length >= 2 ? cabinSource : datedSource;
  const byStops = new Map();
  source.forEach(ticket => {
    const stops = knownStops(ticket);
    const key = stops === null ? 'unknown' : String(stops);
    if (!byStops.has(key)) byStops.set(key, []);
    byStops.get(key).push(Number(ticket.price));
  });
  const durationValues = source.map(knownDuration).filter(finitePositive);
  return {
    marketMedian: median(source.map(ticket => ticket.price)),
    medianByStops: Object.fromEntries([...byStops].map(([key, prices]) => [key, median(prices)])),
    routeDurationBaseline: durationValues.length ? Math.min(...durationValues) : null,
    sampleSize: source.length,
  };
}

function scoreFlights(tickets, preferences = {}, context = {}) {
  const passengers = Math.max(1, Number(context.passengers) || 1);
  const preferredAirlines = parseList(preferences.preferred_airlines).map(value => String(value).toLowerCase());
  const travelStyle = parseList(preferences.travel_style).map(value => String(value).toLowerCase());
  const wantedCabin = String(context.cabinClass || preferences.seat_class || '').toLowerCase() || null;
  let maxStops = context.maxStops === '' || context.maxStops === undefined || context.maxStops === null
    ? (preferences.max_stops !== null && preferences.max_stops !== '' && Number.isFinite(Number(preferences.max_stops)) ? Number(preferences.max_stops) : null)
    : Number(context.maxStops);
  if (maxStops === null && preferences.flight_type === 'direct') maxStops = 0;
  if (maxStops === null && preferences.flight_type === '1stop') maxStops = 1;
  const weights = contextWeights(travelStyle, context.tripDays ?? null, preferences.budget_level);
  const benchmarks = buildBenchmarks(tickets, wantedCabin);

  return tickets.map(ticket => {
    const price = finitePositive(ticket.price) ? Number(ticket.price) : null;
    const stops = knownStops(ticket);
    const duration = knownDuration(ticket);
    const cabin = ticketCabin(ticket);
    const airlineAliases = { ek: 'emirates', qr: 'qatar airways', sq: 'singapore airlines', tk: 'turkish airlines', fz: 'flydubai', ey: 'etihad airways', su: 'aeroflot', ca: 'air china', mu: 'china eastern' };
    const airlineCode = String(ticket.airline || '').toLowerCase();
    const airline = String(ticket.airline_name || airlineAliases[airlineCode] || airlineCode).toLowerCase();
    const seatFit = seatingScore(ticket, passengers);
    const fare = fareConfidence(ticket, { passengers });
    const benchmark = benchmarks.medianByStops[stops === null ? 'unknown' : String(stops)] || benchmarks.marketMedian;

    const preferenceParts = [];
    if (preferredAirlines.length) preferenceParts.push({ key: 'preferred_airline', score: preferredAirlines.some(value => airline.includes(value) || value.includes(airline)) ? 100 : 55, weight: 35 });
    if (wantedCabin) preferenceParts.push({ key: 'cabin', score: cabin ? (cabin === wantedCabin ? 100 : 25) : null, weight: 35 });
    if (maxStops !== null) preferenceParts.push({ key: 'max_stops', score: stops === null ? null : (stops <= maxStops ? 100 : 0), weight: 20 });
    if (passengers > 1) preferenceParts.push({ key: 'group_seating', score: seatFit, weight: 10 });

    const value = priceValueScore(price, benchmark);
    const itinerary = componentAverage([
      { key: 'duration', score: durationScore(duration, benchmarks.routeDurationBaseline), weight: 55 },
      { key: 'stops', score: stopsScore(stops, travelStyle), weight: 45 },
    ]);
    const personal = preferenceParts.length ? componentAverage(preferenceParts) : 80;
    const schedule = scheduleScore(ticket, travelStyle);
    const components = [
      { key: 'value', score: value, weight: weights.value },
      { key: 'itinerary', score: itinerary, weight: weights.itinerary },
      { key: 'preferences', score: personal, weight: weights.preferences },
      { key: 'schedule', score: schedule, weight: weights.schedule },
    ];
    const baseScore = round(componentAverage(components) ?? 0);
    const knownCore = [price !== null, stops !== null, duration !== null, Boolean(ticket.departure_at), Boolean(cabin), seatFit !== null || passengers === 1];
    const reliability = round(35 + (knownCore.filter(Boolean).length / knownCore.length) * 55 + Math.min(benchmarks.sampleSize, 10));
    const adjusted = round(baseScore * 0.8 + reliability * 0.1 + fare.score * 0.1);
    const unknown = [];
    if (price === null) unknown.push('price');
    if (stops === null) unknown.push('stops');
    if (duration === null) unknown.push('duration');
    if (!ticket.departure_at) unknown.push('schedule');
    if (wantedCabin && !cabin) unknown.push('confirmed_cabin');
    if (passengers > 1 && seatFit === null) unknown.push('aircraft_seat_layout');
    if (preferences.seat_position && ticket.seat_selection_available === undefined) unknown.push('seat_selection');
    fare.unknown.forEach(item => { if (!unknown.includes(item)) unknown.push(item); });

    const strictFailures = [];
    if (maxStops !== null && stops !== null && stops > maxStops) strictFailures.push('max_stops');
    if (wantedCabin && cabin && cabin !== wantedCabin) strictFailures.push('cabin_class');

    return {
      ...ticket,
      fairworth_score: baseScore,
      adjusted_score: adjusted,
      score_reliability: reliability,
      score_reliability_level: level(reliability),
      fare_confidence: fare.score,
      fare_confidence_level: level(fare.score),
      score_version: FLIGHT_SCORE_VERSION,
      calculated_at: new Date().toISOString(),
      top_pick_eligible: strictFailures.length === 0 && reliability >= 55 && fare.score >= 45 && !ticket.is_alternative_date,
      strict_filter_failures: strictFailures,
      unknown_score_data: unknown,
      score_breakdown: Object.fromEntries(components.map(item => [item.key, item.score === null ? null : round(item.score)])),
      score_weights: weights,
      score_context: {
        passengers,
        travel_style: travelStyle,
        requested_cabin: wantedCabin,
        max_stops: maxStops,
        group_seating_score: seatFit === null ? null : round(seatFit),
      },
      price_details: {
        unit_price: price,
        total_for_party: price === null ? null : price * passengers,
        passengers,
        benchmark_median: benchmark,
        benchmark_sample_size: benchmarks.sampleSize,
        taxes_included: ticket.taxes_included ?? null,
        fare_type: ticket.fare_type || 'indicative',
        fare_observed_at: ticket.fare_observed_at || null,
        fare_received_at: ticket.fare_received_at || null,
        fare_cache_status: ticket.fare_cache_status || 'provider_cached',
        availability_confirmed: false,
        seat_availability_confirmed: false,
        requires_provider_verification: true,
      },
    };
  });
}

module.exports = { FLIGHT_SCORE_VERSION, scoreFlights, buildBenchmarks, priceValueScore, durationScore, seatingScore };
