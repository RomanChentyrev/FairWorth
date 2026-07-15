# Fairworth Hotel Index

## Overview

Current formula version: **4.5.0**.

The Fairworth Hotel Index is a personalized hotel-ranking system. It evaluates not only the nominal quality of a hotel, but also:

- the value of the current offer;
- review quality and reliability;
- compatibility with the user's declared preferences;
- the context of the current trip;
- completeness and freshness of provider data;
- reliability of the displayed price.

The system calculates three separate values:

1. **Fairworth Score**: the base hotel assessment.
2. **Score Reliability**: confidence in the evidence supporting the Score.
3. **Price Confidence**: confidence in the displayed price and rate conditions.

Missing provider data is not treated as a negative hotel characteristic. Unknown components are excluded from the applicable weighted average and are listed separately in **Why this Score**.

## Base Fairworth Score

The base score is calculated from four components:

| Component | Weight |
|---|---:|
| Personal preference match | 35% |
| Value | 25% |
| Hotel quality | 25% |
| Review confidence | 15% |

```text
Fairworth Score =
  value * 0.25 +
  quality * 0.25 +
  review confidence * 0.15 +
  personal fit * 0.35
```

Only components supported by available data participate in the normalized weighted average.

## Value

For budget and mid-range scenarios, value consists of:

| Signal | Weight |
|---|---:|
| Position against comparable market prices | 60% |
| Guest value-for-money rating | 40% |

For `upscale` and `luxury` trips, the cheapest offer does not automatically receive an advantage. The market-price component is excluded, and value relies primarily on the provider's guest value assessment.

## Comparable Price

The index does not compare a five-star hotel with every hostel in the city. It looks for a stable comparable market segment in this order:

1. city + stars + district + room category;
2. city + stars + district;
3. city + stars + room category;
4. city + stars;
5. city.

At least three comparable offers are required. The benchmark is based on `P25`, median and `P75` rather than the minimum price on the current page.

The selected rate is normalized using:

- full stay price;
- number of nights;
- requested guest count;
- taxes and mandatory fees;
- room category;
- cancellation conditions;
- breakfast inclusion.

Comparison adjustments are applied when occupancy is unverified, taxes are unknown, the room category differs, the rate is non-refundable, or preferred breakfast is missing.

## Hotel Quality

Quality is calculated from:

- overall guest rating;
- cleanliness;
- service;
- location;
- facilities relevant to the travel style;
- review freshness.

Internal quality weights depend on travel style.

### Default

| Signal | Weight |
|---|---:|
| Overall rating | 22.5% |
| Cleanliness | 22.5% |
| Service | 22.5% |
| Location | 22.5% |
| Review freshness | 10% |

### Luxury

Luxury prioritizes service, cleanliness and premium facilities. Service has the largest weight, while stars are handled separately through travel-tier matching.

### Business

Business prioritizes location, service, quiet conditions and work-related facilities such as Wi-Fi and soundproofing.

### Family

Family travel prioritizes cleanliness, location and family facilities.

### Resort, Active And Gastronomy

These profiles increase the contribution of relevant facilities such as pool, beach, SPA, gym, tennis, restaurant and breakfast.

If several styles apply, their quality weights are averaged.

## Review Freshness

Review freshness contributes 10% of hotel quality.

| Signal | Weight |
|---|---:|
| Date of the latest review | 40% |
| Share of reviews from the last 12 months | 25% |
| Rating trend | 25% |
| Renovation freshness | 10% |

The system distinguishes stable ratings, improvement, sharp improvement, decline and sharp decline. Missing freshness signals are excluded and reduce freshness reliability rather than the hotel score itself.

## Review Confidence

The trust component is not based on review count alone.

| Signal | Weight |
|---|---:|
| Review volume | 40% |
| Review freshness | 25% |
| Consistency between sources | 20% |
| Verified stays | 10% |
| Review integrity and rating dispersion | 5% |

Review volume uses logarithmic scaling. Additional data includes suspicious-review share, rating variance and consistency between provider ratings.

The index exposes a separate `review_confidence_reliability` value. A large review count from one poorly described source is therefore not presented as fully verified evidence.

## Personal Fit

Initial preference weights are:

| Preference | Weight |
|---|---:|
| Travel tier | 22% |
| Preferred amenities | 20% |
| Hotel stars | 16% |
| Budget | 14% |
| Room type | 12% |
| Room view | 8% |
| Noise sensitivity | 8% |

These are initial declared weights. They are gradually blended with learned global and trip-context weights as meaningful behavioral evidence accumulates.

## Amenities

Amenities are divided into two groups:

- **required amenities**, which act as strict search filters;
- **preferred amenities**, which influence the Score.

Preferred amenities use weighted partial matching. Confirming one of several selected amenities no longer gives the whole amenity block a score of 100. Different amenities can have different importance.

If the provider supplies no amenity catalogue, selected amenities are marked unknown and excluded. If the provider supplies a catalogue but an amenity is absent, the absence is treated as known evidence.

## Travel Tier

For `luxury`, `upscale` and `mid`, the travel-tier component uses:

| Signal | Default weight |
|---|---:|
| Star fit | 15% |
| Verified quality | 13% |
| Service | 14% |
| Room condition | 10% |
| Room size | 9% |
| Premium amenities | 8% |
| Brand reputation | 7% |
| Breakfast quality | 7% |
| Room category | 6% |
| Luxury review semantics | 7% |
| Renovation freshness | 4% |

When the user explicitly selects hotel stars, the star contribution inside travel tier is reduced from 15% to 5%. This limits duplicate influence from the same characteristic.

For `budget`, travel-tier matching uses the comparable market-price position.

## Room Type And View Matching

Room matching uses similarity rather than a binary text check.

Supported room hierarchy:

```text
standard -> superior -> deluxe -> executive -> junior suite -> suite -> villa
```

Bed types such as `king`, `queen`, `twin`, `double` and `single` are recognized independently from room category.

Examples:

| Preference | Provider room | Match |
|---|---|---:|
| suite | junior suite | 80 |
| junior suite | suite | 95 |
| deluxe | deluxe king room | 100 |
| king | deluxe king room | 100 |

View aliases and modifiers are also recognized:

| Preference | Provider view | Match |
|---|---|---:|
| sea | partial sea view | 75 |
| sea | oceanfront | 100 |
| city | skyline view | 100 |

If room data exists, a weak match is treated as known evidence. It is marked unknown only when the provider does not supply room names or views.

## Score Reliability

Score Reliability measures how much evidence supports each component. It includes:

- market benchmark sample size;
- tax and occupancy certainty;
- rate freshness;
- quality-data completeness;
- review-confidence completeness;
- availability of preference-related hotel attributes.

Reliability does not directly replace the base Score. It is used in adjusted ranking.

## Price Confidence

Price Confidence starts higher for live provider data and is reduced when:

- the price is older than 1, 6 or 12 hours;
- tax status is unknown;
- occupancy is unverified;
- room category does not match;
- the price is stale;
- the price is demonstrational or not displayable.

Demonstrational and non-displayable prices receive zero confidence. Stale prices are capped at 35.

An offer is eligible for `AI Top Pick` only when price confidence is at least 60 and the price is neither stale nor demonstrational.

## Adjusted Ranking Score

Search sorting uses:

```text
Adjusted Score =
  Fairworth Score * 0.80 +
  Score Reliability * 0.10 +
  Price Confidence * 0.10
```

This preserves the base personalized assessment while preventing incomplete or unreliable offers from dominating the ranking.

## Contextual Learning

Learning is separated by:

- trip purpose: leisure, business, family or couple;
- duration: short, medium or long;
- destination;
- season;
- party size: solo, two people, small group or large group.

Each meaningful event updates the global profile and matching context profiles. Context profiles are blended with the global profile gradually according to accumulated evidence.

The system does not learn from a simple first page view. Current interaction strengths include:

| Event | Signal |
|---|---:|
| First hotel view | 0 |
| 20-59 seconds on detail page | +0.5 |
| 60-179 seconds | +1 |
| 180+ seconds | +2 |
| Gallery view | +0.75 |
| Rooms opened | +1.25 |
| Return visit | +1.5 |
| Added to comparison | +2 |
| Added to trip | +3 |
| Removed from trip | -2.5 |
| Checkout started | +6 |
| Booking completed | +10 |

Behavioral learning is enabled only when the user has granted behavioral-tracking consent.

## Negative Feedback

When hiding a hotel, the user selects a reason:

- too expensive;
- unsuitable location;
- disliked photos;
- missing pool;
- low star rating;
- another reason.

Transferable reasons update only their related factor. For example, `too expensive` affects budget learning but does not change star or amenity preferences. Reasons without a reliable transferable feature, such as disliked photos, hide the hotel in the matching trip context without changing unrelated weights.

Hidden hotels are excluded server-side for the same context but can remain available for a different trip scenario.

## Explainability

The hotel detail page exposes **Why this Score**, including:

- formula version and calculation time;
- base and adjusted scores;
- score, price and review reliability;
- component breakdowns and weights;
- comparable price and market benchmark;
- rate conditions and warnings;
- review freshness and trend;
- room and view similarity;
- active learning contexts;
- provider fields that were unavailable and excluded.

## Strengths

- Missing data is separated from negative evidence.
- Price, Score and reliability are modeled independently.
- Price comparison uses normalized rates and stable market segments.
- Luxury experience is broader than star rating.
- Quality weights adapt to travel style.
- Review confidence includes freshness, structure and source agreement.
- Amenities and room descriptions support partial weighted matching.
- Learning uses meaningful behavior rather than raw clicks.
- Trip contexts are isolated from each other.
- Negative feedback updates specific factors instead of guessing.
- Score calculations are versioned and monitored for large changes.

## Recommended Future Improvements

The current architecture is suitable for a closed MVP. Future work should be driven by real user data rather than adding more heuristic complexity.

The highest-value next improvements are:

1. Use the same hierarchical room matching in comparable-rate normalization, which currently relies on broader room categories.
2. Apply the selected `trip_purpose` directly to the quality profile instead of relying mainly on the saved global travel style.
3. Add a minimum Score Reliability threshold for `AI Top Pick`, in addition to the existing price-confidence requirement.
4. Calibrate weights against actual comparison, trip-add, checkout and booking outcomes.
5. Expand multilingual review semantics and provider-specific review normalization.

The index does not currently require a major redesign. Its main next stage is validation and calibration using behavior from the closed MVP.
