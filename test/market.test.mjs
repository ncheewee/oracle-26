import assert from "node:assert/strict";
import test from "node:test";
import market from "../outputs/market-odds.json" with { type: "json" };
import simulation from "../outputs/tournament-simulation.json" with { type: "json" };

test("market snapshot comes from the official Singapore Pools source", () => {
  assert.equal(market.source.name, "Singapore Pools");
  assert.match(market.source.url, /singaporepools\.com/);
  assert.ok(market.responsiblePlay);
});

test("verified championship market covers every active title contender", () => {
  assert.ok(market.championship.length > 0);
  assert.ok(market.championship.every((item) => item.decimalOdds > 1));
  if (market.outright?.status !== "verified") return;
  const pricedTeams = market.championship
    .map((item) => item.team)
    .sort();
  const activeTeams = simulation.teams
    .filter((team) => team.probabilities.champion > 0)
    .map((team) => team.name)
    .sort();
  assert.deepEqual(pricedTeams, activeTeams);
});

test("value watchlist obeys the conservative publication gate", () => {
  assert.ok(Array.isArray(market.valueWatchlist));
  assert.ok(
    market.valueWatchlist.every(
      (item) => item.modelProbability >= 5 && item.probabilityEdge >= 2,
    ),
  );
});
