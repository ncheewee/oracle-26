import assert from "node:assert/strict";
import test from "node:test";
import market from "../outputs/market-odds.json" with { type: "json" };

test("market snapshot comes from the official Singapore Pools source", () => {
  assert.equal(market.source.name, "Singapore Pools");
  assert.match(market.source.url, /singaporepools\.com/);
  assert.ok(market.responsiblePlay);
});

test("championship market has broad coverage", () => {
  assert.ok(market.championship.length >= 20);
  assert.ok(market.championship.every((item) => item.decimalOdds > 1));
});

test("value watchlist obeys the conservative publication gate", () => {
  assert.ok(market.valueWatchlist.length > 0);
  assert.ok(
    market.valueWatchlist.every(
      (item) => item.modelProbability >= 5 && item.probabilityEdge >= 2,
    ),
  );
});
