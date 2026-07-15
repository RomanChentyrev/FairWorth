# Fairworth Flight Index

## Purpose

The Flight Index ranks comparable live fares for the current user and trip. Version `1.0.0` is calculated on the server. The UI never recalculates it from the visible result set.

## Scores

`Base Flight Score` is an applicable weighted average:

- value: 30%;
- itinerary quality: 30%;
- preference fit: 25%;
- schedule fit: 15%.

Weights adapt for business, family and short-trip contexts. Business and short trips favour itinerary and schedule; family travel gives extra importance to stops and group convenience.

`Adjusted Score = Base Score * 0.80 + Score Reliability * 0.10 + Fare Confidence * 0.10`.

The adjusted score is used for ranking. Base score remains the user-facing suitability assessment.

## Value

Price is compared with the median of comparable results for the exact date and the same number of stops. It is not compared with the most expensive item in the response. The response also exposes the unit price, passenger count and calculated party total.

The provider currently does not consistently confirm that a quote covers the whole party. This does not reduce Base Score, but lowers Fare Confidence.

## Itinerary

Duration is measured relative to the fastest credible itinerary in the route cohort. Stops have context-dependent penalties: business and family trips are less tolerant of connections.

Layover duration, airport changes and overnight connections are supported conceptually but remain unknown until the provider supplies segment-level data.

## Preferences And Strict Filters

Preferred airlines, requested cabin, maximum stops and travel style are read from the user's database profile. An explicit maximum-stops mismatch and a confirmed cabin mismatch are strict failures. Unknown cabin data is not treated as a mismatch.

## Passengers And Seating

Party price is calculated for the selected passenger count. When a provider supplies a confirmed cabin layout (`seat_blocks`, `seat_layout` such as `2-4-2`, or `seats_abreast`), group seating affects preference fit. A pair receives a better fit for a two-seat side block than for a three-seat block.

Travelpayouts does not currently provide a dependable aircraft seat map in the price endpoint. In that case seating fit is unknown, Base Score is unchanged, and Score Reliability identifies the missing `aircraft_seat_layout` field. Fairworth must not infer a layout from an airline or flight number.

## Confidence

Score Reliability reflects coverage of price, stops, duration, schedule, confirmed cabin and group seating data. Fare Confidence separately evaluates source quality, exact-date status, booking link, expiry, taxes and fees, baggage, refundability, cabin confirmation and party-price confirmation.

Unknown fields are excluded from the applicable Base Score denominator and listed under **Why this Score**. They affect confidence, not the hotel's or flight's intrinsic quality.

## Top Pick

A fare is eligible only when it passes strict filters, is on the requested date, has at least medium score reliability and meets the minimum fare-confidence threshold. Ranking prioritises Top Pick eligibility, then Adjusted Score, Base Score and price.

## Provider Limitations

The current Travelpayouts metasearch feed often lacks taxes, baggage, refund rules, confirmed cabin, segment layovers and seat layout. These values are displayed as unknown rather than fabricated. A richer fare/booking provider can populate the existing scoring fields later without changing the public score contract.
