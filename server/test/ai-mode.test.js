const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planMessage, redactSensitiveText, mergeSearchContext, profileSubset, fallbackPlan, planSchema, extractDateRangePatch, extractRequestPatch, isBroadDestination, currentYearDateHintPatch,
} = require('../services/aiModeOrchestrator');

test('AI Mode redacts common sensitive values before persistence and prompting', () => {
  const value = redactSensitiveText('Email me at alex@example.com, card 4111 1111 1111 1111, passport AB1234567');
  assert.equal(value.includes('alex@example.com'), false);
  assert.equal(value.includes('4111 1111 1111 1111'), false);
  assert.equal(value.includes('AB1234567'), false);
  assert.match(value, /\[email redacted\]/);
});

test('AI Mode merges only explicitly supplied context changes', () => {
  const context = mergeSearchContext(
    { destination: 'Paris', date_start: '2026-10-10', travelers: 2, budget_amount: 2000 },
    { budget_amount: 1500 },
  );
  assert.deepEqual(context, { destination: 'Paris', date_start: '2026-10-10', travelers: 2, budget_amount: 1500 });
});

test('AI Mode profile subset excludes identity and contact fields', () => {
  const subset = profileSubset({
    email: 'private@example.com', phone: '+123456789', hotel_stars: '["4","5"]',
    travel_style: '["luxury"]', budget_per_night_max: '500', max_stops: 1,
  });
  assert.equal(Object.hasOwn(subset, 'email'), false);
  assert.equal(Object.hasOwn(subset, 'phone'), false);
  assert.deepEqual(subset.hotel_stars, ['4', '5']);
  assert.equal(subset.budget_per_night_max, 500);
});

test('AI Mode fallback never launches hotel search without dates', () => {
  const plan = fallbackPlan('Find me a hotel', { destination: 'Paris' }, 'en');
  assert.equal(plan.intent, 'hotel_search');
  assert.equal(plan.action.type, 'none');
  assert.deepEqual(plan.missing_fields, ['date_start', 'date_end']);
  assert.match(plan.reply, /check-in and check-out dates/i);
});

test('AI Mode fallback preserves the previous search intent for short follow-ups', () => {
  const plan = fallbackPlan('Which detail?', { destination: 'Paris' }, 'en', { previousIntent: 'hotel_search' });
  assert.equal(plan.intent, 'hotel_search');
  assert.deepEqual(plan.missing_fields, ['date_start', 'date_end']);
  assert.match(plan.reply, /check-in and check-out dates/i);
  const recovered = fallbackPlan('Which detail?', { destination: 'Paris' }, 'en', {
    previousIntent: 'support', recentMessages: [{ role: 'user', content: 'I want a new hotel with a sea view' }],
  });
  assert.equal(recovered.intent, 'hotel_search');
  assert.deepEqual(recovered.missing_fields, ['date_start', 'date_end']);
});

test('AI Mode applies the current year to a date range without a year', () => {
  const pending = extractDateRangePatch('We want to fly from 1 September to 14 September');
  const year = new Date().getFullYear();
  assert.deepEqual(pending, { date_start: `${year}-09-01`, date_end: `${year}-09-14`, date_range_hint: null });
  assert.deepEqual(extractDateRangePatch('from 10 to 15 october'), {
    date_start: `${year}-10-10`, date_end: `${year}-10-15`, date_range_hint: null,
  });
  assert.deepEqual(extractDateRangePatch('from 10 for 15 october'), {
    date_start: `${year}-10-10`, date_end: `${year}-10-15`, date_range_hint: null,
  });
  assert.deepEqual(extractDateRangePatch('from 2026-10-10 to 2026-10-15'), {
    date_start: '2026-10-10', date_end: '2026-10-15', date_range_hint: null,
  });
  assert.deepEqual(currentYearDateHintPatch({ date_range_hint: { start_day: 1, end_day: 14, month: 9 } }), pending);
});

test('AI Mode parses date ranges in every product language', () => {
  const year = new Date().getFullYear();
  const expected = { date_start: `${year}-10-10`, date_end: `${year}-10-15`, date_range_hint: null };
  for (const value of [
    'с 10 по 15 октября', 'vom 10. bis 15. Oktober', 'du 10 au 15 octobre',
    'dal 10 al 15 ottobre', 'del 10 al 15 octubre', '10月10日至10月15日', 'من 10 إلى 15 أكتوبر',
  ]) assert.deepEqual(extractDateRangePatch(value), expected, value);
});

test('AI Mode deterministically keeps direct-flight and hotel-view preferences', () => {
  const patch = extractRequestPatch('I want a new hotel with a sea view and a direct flight');
  assert.equal(patch.max_stops, 0);
  assert.deepEqual(patch.soft_preferences, ['sea_view', 'new_or_recently_renovated']);
});

test('AI Mode fallback executes complete hotel and flight requests without the model', () => {
  const hotel = fallbackPlan('Find a romantic hotel in Paris from 10 to 15 October for 2 people under 2500 USD', {}, 'en');
  assert.equal(hotel.action.type, 'hotel_search');
  assert.equal(hotel.context_patch.destination, 'Paris');
  assert.equal(hotel.context_patch.travelers, 2);
  assert.equal(hotel.context_patch.budget_amount, 2500);
  assert.deepEqual(hotel.context_patch.soft_preferences, ['romantic']);

  const flight = fallbackPlan('Find a direct business class flight from Moscow to Paris on 10 October 2026 for two travelers', {}, 'en');
  assert.equal(flight.action.type, 'flight_search');
  assert.equal(flight.context_patch.origin, 'Moscow');
  assert.equal(flight.context_patch.destination, 'Paris');
  assert.equal(flight.context_patch.date_start, '2026-10-10');
  assert.equal(flight.context_patch.travelers, 2);
  assert.equal(flight.context_patch.cabin_class, 'business');
  assert.equal(flight.context_patch.max_stops, 0);
});

test('AI Mode fallback handles a complete Russian request without the model', () => {
  const hotel = fallbackPlan('Найди отель в Париже с 10 по 15 октября для двоих', {}, 'ru');
  assert.equal(hotel.action.type, 'hotel_search');
  assert.equal(hotel.context_patch.destination, 'Paris');
  assert.equal(hotel.context_patch.travelers, 2);
  assert.deepEqual(hotel.missing_fields, []);
});

test('AI Mode fallback supports cheaper, compare and itinerary actions', () => {
  const context = { destination: 'Paris', date_start: '2026-10-10', date_end: '2026-10-15', budget_amount: 2500, currency: 'USD' };
  const cheaper = fallbackPlan('Show me cheaper options', context, 'en', { previousIntent: 'hotel_search' });
  assert.equal(cheaper.action.type, 'hotel_search');
  assert.equal(cheaper.context_patch.budget_amount, 2000);

  const compare = fallbackPlan('Compare 1 and 3', context, 'en');
  assert.equal(compare.action.type, 'compare');
  assert.deepEqual(compare.action.result_indexes, [1, 3]);

  const itinerary = fallbackPlan('Build an itinerary', context, 'en');
  assert.equal(itinerary.action.type, 'itinerary');
  assert.deepEqual(itinerary.missing_fields, []);
});

test('AI Mode does not mistake a monetary amount for traveler count', () => {
  const patch = extractRequestPatch('We want a beach holiday in Asia for 4000 USD');
  assert.equal(patch.travelers, undefined);
  assert.equal(patch.budget_amount, 4000);
  assert.equal(patch.currency, 'USD');
  assert.equal(patch.destination, 'Asia');
});

test('AI Mode planner fallback applies relative changes exactly once', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const broad = await planMessage({ message: 'We want a beach holiday in Asia for 4000 USD', language: 'en' });
    assert.equal(broad.context.travelers, undefined);
    assert.equal(broad.context.budget_amount, 4000);

    const cheaper = await planMessage({
      message: 'Show me cheaper options', language: 'en', previousIntent: 'hotel_search',
      currentContext: { destination: 'Paris', date_start: '2026-10-10', date_end: '2026-10-15', budget_amount: 2500, currency: 'USD' },
    });
    assert.equal(cheaper.context.budget_amount, 2000);
    assert.equal(cheaper.action.type, 'hotel_search');
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test('AI Mode requires a concrete destination before a provider search', () => {
  assert.equal(isBroadDestination('Southeast Asia'), true);
  assert.equal(isBroadDestination('France'), true);
  assert.equal(isBroadDestination('Paris'), false);
  assert.equal(isBroadDestination('Singapore'), false);
  assert.equal(isBroadDestination('hotels'), true);
  assert.equal(isBroadDestination('Da Nang'), false);
  const plan = fallbackPlan('Find a hotel', {
    destination: 'Southeast Asia', date_start: '2026-09-01', date_end: '2026-09-14',
  }, 'en', { previousIntent: 'hotel_search' });
  assert.deepEqual(plan.missing_fields, ['destination']);
  assert.match(plan.reply, /exact city or island/i);
  const continued = fallbackPlan('Da Nang', {
    origin: 'Moscow', destination: 'Southeast Asia', date_start: '2026-09-01', date_end: '2026-09-14',
  }, 'en', { previousIntent: 'hotel_search' });
  assert.equal(continued.context_patch.destination, 'Da Nang');
  assert.equal(continued.action.type, 'hotel_search');
});

test('AI Mode does not mistake a search type for a destination', () => {
  const hotelChoice = fallbackPlan('hotels', {}, 'en');
  assert.equal(hotelChoice.intent, 'hotel_search');
  assert.equal(hotelChoice.context_patch.destination, undefined);
  assert.deepEqual(hotelChoice.missing_fields, ['destination', 'date_start', 'date_end']);
  assert.match(hotelChoice.reply, /exact city or island/i);

  const dates = fallbackPlan('from 2026-10-10 to 2026-10-15', {
    destination: 'hotels',
  }, 'en', { previousIntent: 'hotel_search' });
  assert.equal(dates.context_patch.date_start, '2026-10-10');
  assert.equal(dates.context_patch.date_end, '2026-10-15');
  assert.deepEqual(dates.missing_fields, ['destination']);
  assert.match(dates.reply, /exact city or island/i);
});

test('AI Mode turns country-level inspiration into a concrete hotel clarification', () => {
  const plan = fallbackPlan('from 10 to 15 october', {
    destination: 'France', travelers: 2, budget_amount: 5000, currency: 'USD',
  }, 'en', { previousIntent: 'inspiration' });
  const year = new Date().getFullYear();
  assert.equal(plan.intent, 'hotel_search');
  assert.equal(plan.action.type, 'none');
  assert.deepEqual(plan.missing_fields, ['destination']);
  assert.equal(plan.context_patch.date_start, `${year}-10-10`);
  assert.equal(plan.context_patch.date_end, `${year}-10-15`);
  assert.match(plan.reply, /exact city or island/i);

  const continued = fallbackPlan('Paris', mergeSearchContext({
    destination: 'France', travelers: 2,
  }, plan.context_patch), 'en', { previousIntent: plan.intent });
  assert.equal(continued.context_patch.destination, 'Paris');
  assert.equal(continued.action.type, 'hotel_search');
  assert.match(continued.reply, /check the connected travel providers/i);
});

test('AI Mode never claims provider search for a non-search action', () => {
  const plan = fallbackPlan('Hello', {}, 'en');
  assert.equal(plan.action.type, 'none');
  assert.doesNotMatch(plan.reply, /check the connected travel providers/i);
});

test('AI Mode fallback completes a multi-turn destination and date clarification without looping', () => {
  let context = {
    origin: 'Moscow', destination: 'Southeast Asia', travelers: 2,
    ...extractDateRangePatch('from 1 September to 14 September'),
  };
  const cityQuestion = fallbackPlan('from 1 September to 14 September', context, 'en', { previousIntent: 'hotel_search' });
  assert.deepEqual(cityQuestion.missing_fields, ['destination']);
  assert.match(cityQuestion.reply, /exact city or island/i);

  const cityAnswer = fallbackPlan('Da Nang', context, 'en', { previousIntent: 'hotel_search' });
  context = mergeSearchContext(context, cityAnswer.context_patch);
  const year = new Date().getFullYear();
  assert.deepEqual(cityAnswer.missing_fields, []);
  assert.equal(context.destination, 'Da Nang');
  assert.equal(context.date_start, `${year}-09-01`);
  assert.equal(context.date_end, `${year}-09-14`);
  assert.equal(cityAnswer.action.type, 'hotel_search');
});

test('AI Mode replaces an existing destination when the traveler changes their mind', () => {
  const context = {
    origin: 'Moscow', destination: 'Paris', date_start: '2026-10-10', date_end: '2026-10-15', travelers: 2,
  };
  for (const [message, expected] of [
    ['I changed my mind, now I want to go to Madrid', 'Madrid'],
    ['Instead, let\'s go to Barcelona', 'Barcelona'],
    ['Я передумал, теперь хочу в Мадрид', 'Мадрид'],
  ]) {
    const plan = fallbackPlan(message, context, 'en', { previousIntent: 'hotel_search' });
    assert.equal(plan.context_patch.destination, expected, message);
    assert.equal(plan.action.type, 'hotel_search', message);
    assert.deepEqual(plan.missing_fields, [], message);
  }
});

test('AI Mode normalizes a common Nha Trang spelling mistake', () => {
  const plan = fallbackPlan('Nha Thang', {
    origin: 'Moscow', date_start: '2026-10-10', date_end: '2026-10-20', travelers: 2,
  }, 'en', { previousIntent: 'flight_search' });
  assert.equal(plan.context_patch.destination, 'Nha Trang');
  assert.equal(plan.action.type, 'flight_search');
});

test('AI Mode switches between hotel and flight search in the same conversation', () => {
  const context = {
    origin: 'Moscow', destination: 'Madrid', date_start: '2026-10-10', date_end: '2026-10-15', travelers: 2,
  };
  const flight = fallbackPlan('Now find me flights too', context, 'en', { previousIntent: 'hotel_search' });
  assert.equal(flight.intent, 'flight_search');
  assert.equal(flight.action.type, 'flight_search');
  assert.equal(flight.context_patch.destination, undefined);

  const hotel = fallbackPlan('Теперь подбери отель', context, 'ru', { previousIntent: 'flight_search' });
  assert.equal(hotel.intent, 'hotel_search');
  assert.equal(hotel.action.type, 'hotel_search');

  const needsOrigin = fallbackPlan('Now find me flights too', {
    destination: 'Madrid', date_start: '2026-10-10', date_end: '2026-10-15', travelers: 2,
  }, 'en', { previousIntent: 'hotel_search' });
  assert.deepEqual(needsOrigin.missing_fields, ['origin']);
  const originAnswer = fallbackPlan('Moscow', {
    destination: 'Madrid', date_start: '2026-10-10', date_end: '2026-10-15', travelers: 2,
  }, 'en', { previousIntent: 'flight_search' });
  assert.equal(originAnswer.context_patch.origin, 'Moscow');
  assert.equal(originAnswer.action.type, 'flight_search');
});

test('AI Mode budget planning gathers every field and launches a dedicated action', () => {
  let context = {};
  let plan = fallbackPlan('Help me plan a trip within my budget', context, 'en');
  assert.equal(plan.intent, 'budget');
  assert.equal(plan.action.type, 'none');
  assert.deepEqual(plan.missing_fields, ['origin', 'destination', 'date_start', 'date_end', 'budget_amount']);

  context = {
    origin: 'Moscow', destination: 'Madrid', date_start: '2026-10-10', date_end: '2026-10-15',
    travelers: 2, budget_amount: 3000, currency: 'USD',
  };
  plan = fallbackPlan('Plan the complete trip within my budget', context, 'en', { previousIntent: 'budget' });
  assert.equal(plan.intent, 'budget');
  assert.equal(plan.action.type, 'budget_plan');
  assert.deepEqual(plan.missing_fields, []);
  assert.match(plan.reply, /hotel and flight prices/i);
});

test('AI Mode budget clarification fills a broad destination before the origin', () => {
  let context = {};
  let plan = fallbackPlan('Help me plan a trip within my budget', context, 'en');
  context = mergeSearchContext(context, plan.context_patch);
  assert.deepEqual(plan.missing_fields, ['origin', 'destination', 'date_start', 'date_end', 'budget_amount']);
  assert.match(plan.reply, /exact city or island/i);

  plan = fallbackPlan('Vietnam', context, 'en', { previousIntent: plan.intent });
  context = mergeSearchContext(context, plan.context_patch);
  assert.equal(context.destination, 'Vietnam');
  assert.equal(context.origin, undefined);
  assert.deepEqual(plan.missing_fields, ['origin', 'destination', 'date_start', 'date_end', 'budget_amount']);

  plan = fallbackPlan('Paris', context, 'en', { previousIntent: plan.intent });
  context = mergeSearchContext(context, plan.context_patch);
  assert.equal(context.destination, 'Paris');
  assert.equal(context.origin, undefined);
  assert.deepEqual(plan.missing_fields, ['origin', 'date_start', 'date_end', 'budget_amount']);
  assert.match(plan.reply, /depart from/i);

  plan = fallbackPlan('Moscow', context, 'en', { previousIntent: plan.intent });
  context = mergeSearchContext(context, plan.context_patch);
  assert.equal(context.destination, 'Paris');
  assert.equal(context.origin, 'Moscow');
  assert.deepEqual(plan.missing_fields, ['date_start', 'date_end', 'budget_amount']);
  assert.match(plan.reply, /check-in and check-out dates/i);
});

test('AI Mode plan schema rejects unsupported tools', () => {
  assert.throws(() => planSchema.parse({
    intent: 'hotel_search', reply: 'Searching', context_patch: {},
    action: { type: 'book_now' }, missing_fields: [], used_profile_fields: [],
  }));
  assert.doesNotThrow(() => planSchema.parse({
    intent: 'budget', reply: 'Calculating', context_patch: {},
    action: { type: 'budget_plan' }, missing_fields: [], used_profile_fields: [],
  }));
});
