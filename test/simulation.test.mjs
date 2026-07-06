import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Annex C contains all 495 unique combinations", () => {
  const allocation = JSON.parse(
    fs.readFileSync("config/third-place-allocation.json", "utf8"),
  ).combinations;
  assert.equal(Object.keys(allocation).length, 495);
  for (const mapping of Object.values(allocation)) {
    assert.equal(Object.keys(mapping).length, 8);
    assert.equal(new Set(Object.values(mapping)).size, 8);
  }
});

test("tournament winner probabilities sum to 100", () => {
  if (!fs.existsSync("outputs/tournament-simulation.json")) return;
  const simulation = JSON.parse(
    fs.readFileSync("outputs/tournament-simulation.json", "utf8"),
  );
  const total = simulation.teams.reduce(
    (sum, team) => sum + team.probabilities.champion,
    0,
  );
  assert.ok(Math.abs(total - 100) <= 1.5);
  assert.equal(simulation.format.thirdPlaceCombinations, 495);
  assert.equal(simulation.format.conditionedOnCompletedKnockoutResults, true);
  assert.match(simulation.format.groupStageOutcomes, /completed knockout results are locked/i);
  assert.equal(Object.keys(simulation.projectedMatches).length, 31);
  for (const team of simulation.teams) {
    const probabilities = team.probabilities;
    assert.ok(probabilities.champion <= probabilities.final);
    assert.ok(probabilities.final <= probabilities.semifinal);
    assert.ok(probabilities.semifinal <= probabilities.quarterfinal);
    assert.ok(probabilities.quarterfinal <= probabilities.roundOf16);
    assert.ok(probabilities.roundOf16 <= probabilities.qualified);
  }
});

test("completed knockout results are locked and eliminated teams have zero title chance", () => {
  if (
    !fs.existsSync("outputs/tournament-simulation.json") ||
    !fs.existsSync("outputs/worldcup.json")
  ) return;
  const simulation = JSON.parse(
    fs.readFileSync("outputs/tournament-simulation.json", "utf8"),
  );
  const worldCup = JSON.parse(fs.readFileSync("outputs/worldcup.json", "utf8"));
  const teamByName = new Map(simulation.teams.map((team) => [team.name, team]));

  for (const match of worldCup.fixtures.filter(
    (fixture) => fixture.matchNumber >= 73 && fixture.status === "FT",
  )) {
    const projection = simulation.projectedMatches[`M${match.matchNumber}`];
    assert.equal(projection?.probability, 100);
    if (match.homeScore === match.awayScore) continue;
    const winner = match.homeScore > match.awayScore ? match.home.name : match.away.name;
    const loser = match.homeScore > match.awayScore ? match.away.name : match.home.name;
    assert.equal(projection.predictedWinner, winner);
    assert.equal(teamByName.get(loser)?.probabilities.champion, 0);
  }

  for (const match of worldCup.fixtures.filter(
    (fixture) => fixture.stage === "Quarter-final",
  )) {
    for (const participant of [match.home.name, match.away.name]) {
      if (/^W\d+$/.test(participant)) continue;
      assert.equal(teamByName.get(participant)?.probabilities.quarterfinal, 100);
    }
  }
});
