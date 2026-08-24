export function buildBudgetOptions({ hotels = [], flights = [], context = {} }) {
  const budget = Number(context.budget_amount || 0);
  const travelers = Math.max(1, Number(context.travelers || 2));
  const start = new Date(`${context.date_start}T00:00:00`);
  const end = new Date(`${context.date_end}T00:00:00`);
  const nights = Math.max(1, Math.round((end - start) / 86400000));
  const currency = context.currency || hotels[0]?.currency || flights[0]?.currency || 'USD';
  const options = [];

  for (const hotel of hotels.slice(0, 5)) {
    for (const flight of flights.slice(0, 5)) {
      const hotelTotal = Number(hotel.price) * nights;
      const flightTotal = Number(flight.price) * travelers;
      const total = hotelTotal + flightTotal;
      if (![hotelTotal, flightTotal, total].every(Number.isFinite) || hotelTotal <= 0 || flightTotal <= 0) continue;
      options.push({
        id: `${hotel.id}-${flight.id}`,
        type: 'budget_option',
        hotel,
        flight,
        nights,
        travelers,
        hotel_total: hotelTotal,
        flight_total: flightTotal,
        total,
        currency,
        budget_amount: budget,
        within_budget: total <= budget,
        remaining_budget: Math.max(0, budget - total),
        shortfall: Math.max(0, total - budget),
        combined_score: Math.round((Number(hotel.adjusted_score || hotel.score || 0) + Number(flight.adjusted_score || flight.score || 0)) / 2),
      });
    }
  }

  const withinBudget = options.filter(option => option.within_budget)
    .sort((a, b) => b.combined_score - a.combined_score || a.total - b.total);
  const closest = options.filter(option => !option.within_budget).sort((a, b) => a.shortfall - b.shortfall);
  return {
    results: (withinBudget.length ? withinBudget : closest).slice(0, 4),
    hasWithinBudget: withinBudget.length > 0,
  };
}
