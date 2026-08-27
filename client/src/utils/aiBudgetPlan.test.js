import { describe, expect, it } from 'vitest';
import { buildBudgetOptions, buildRoundTripOffers } from './aiBudgetPlan';

const hotel = { id: 'hotel-1', name: 'Madrid Stay', price: 200, adjusted_score: 90, currency: 'USD' };
const flight = { id: 'flight-1', airline: 'Example Air', price: 300, adjusted_score: 80, currency: 'USD' };

describe('buildBudgetOptions', () => {
  it('calculates hotel nights and per-traveler flight totals', () => {
    const plan = buildBudgetOptions({
      hotels: [hotel], flights: [flight],
      context: { date_start: '2026-10-10', date_end: '2026-10-15', travelers: 2, budget_amount: 2000, currency: 'USD' },
    });
    expect(plan.hasWithinBudget).toBe(true);
    expect(plan.results[0]).toMatchObject({ nights: 5, hotel_total: 1000, flight_total: 600, total: 1600, remaining_budget: 400, within_budget: true });
  });

  it('returns the nearest real combination when every option exceeds the budget', () => {
    const plan = buildBudgetOptions({
      hotels: [hotel, { ...hotel, id: 'hotel-2', price: 250 }], flights: [flight],
      context: { date_start: '2026-10-10', date_end: '2026-10-15', travelers: 2, budget_amount: 1200, currency: 'USD' },
    });
    expect(plan.hasWithinBudget).toBe(false);
    expect(plan.results[0]).toMatchObject({ id: 'hotel-1-flight-1', total: 1600, shortfall: 400, within_budget: false });
  });

  it('does not create a plan without priced hotels and flights', () => {
    expect(buildBudgetOptions({ hotels: [hotel], flights: [], context: {} }).results).toEqual([]);
  });
});

it('assembles independently priced outbound and return legs', () => {
  const offers = buildRoundTripOffers(
    [{ id: 'out', price: 500, score: 80, adjusted_score: 75, departure_at: '2027-01-11T10:00:00Z' }],
    [{ id: 'back', price: 450, score: 84, adjusted_score: 79, departure_at: '2027-01-12T12:00:00Z' }],
  );
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({
    price: 950,
    return_at: '2027-01-12T12:00:00Z',
    adjusted_score: 77,
    round_trip_legs: { inbound: { id: 'back' } },
  });
});
