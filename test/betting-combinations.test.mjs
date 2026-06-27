import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDutchBasket,
  findWorthwhileOutrightBaskets,
} from "../lib/betting-combinations.mjs";

test("equal-payout dutch price is not accumulator multiplication", () => {
  const basket = evaluateDutchBasket([
    { team: "France", decimalOdds: 4, modelProbability: 4.7 },
    { team: "Argentina", decimalOdds: 6, modelProbability: 20.5 },
  ]);
  assert.equal(basket.effectiveOdds, 2.4);
  assert.equal(basket.coverageProbability, 25.2);
  assert.equal(basket.expectedReturn, -39.5);
  assert.deepEqual(
    basket.legs.map((leg) => leg.stakeShare),
    [60, 40],
  );
});

test("worthwhile baskets require positive legs and meaningful coverage", () => {
  const baskets = findWorthwhileOutrightBaskets([
    { team: "Argentina", decimalOdds: 6, modelProbability: 20.5 },
    { team: "Morocco", decimalOdds: 30, modelProbability: 9 },
    { team: "France", decimalOdds: 4, modelProbability: 4.7 },
  ]);
  assert.equal(baskets.length, 1);
  assert.deepEqual(
    baskets[0].legs.map((leg) => leg.team),
    ["Argentina", "Morocco"],
  );
  assert.equal(baskets[0].effectiveOdds, 5);
  assert.equal(baskets[0].expectedReturn, 47.5);
});
