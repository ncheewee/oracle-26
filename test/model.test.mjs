import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const aliases = {
  "Korea Republic": "South Korea",
  Czechia: "Czech Republic",
  "Côte d'Ivoire": "Ivory Coast",
  "Cabo Verde": "Cape Verde",
  Türkiye: "Turkey",
  "IR Iran": "Iran",
  "Congo DR": "DR Congo",
  USA: "United States",
  Curaçao: "Curacao",
};
const canonical = (name) => aliases[name] || name;

test("validated model output contains no fabricated title probability", () => {
  if (!fs.existsSync("outputs/model.json")) return;
  const model = JSON.parse(fs.readFileSync("outputs/model.json", "utf8"));
  assert.equal("winProbability" in model.provisionalFavorite, false);
  assert.ok(["baseline_validated", "validation_failed"].includes(model.status));
  assert.ok(Number.isInteger(model.source.liveTournamentResults));
  assert.ok(model.source.liveTournamentResults > 0);
});

test("all match probability triples sum to approximately 100", () => {
  if (!fs.existsSync("outputs/model.json")) return;
  const model = JSON.parse(fs.readFileSync("outputs/model.json", "utf8"));
  for (const match of model.predictions) {
    const total =
      match.probabilities.home +
      match.probabilities.draw +
      match.probabilities.away;
    assert.ok(Math.abs(total - 100) <= 0.2);
  }
});

test("match model covers every predictable scheduled FIFA fixture with draw probabilities", () => {
  if (
    !fs.existsSync("outputs/model.json") ||
    !fs.existsSync("outputs/worldcup.json")
  ) return;
  const model = JSON.parse(fs.readFileSync("outputs/model.json", "utf8"));
  const worldCup = JSON.parse(fs.readFileSync("outputs/worldcup.json", "utf8"));
  const contenderNames = new Set(model.contenders.map((team) => team.name));
  const predictableFixtures = worldCup.fixtures.filter(
    (match) =>
      match.status === "Scheduled" &&
      match.homeScore === null &&
      match.awayScore === null &&
      contenderNames.has(canonical(match.home?.name)) &&
      contenderNames.has(canonical(match.away?.name)),
  );

  assert.equal(model.predictions.length, predictableFixtures.length);
  assert.deepEqual(
    model.predictions.map((match) => match.matchNumber).sort((a, b) => a - b),
    predictableFixtures.map((match) => match.matchNumber).sort((a, b) => a - b),
  );
  assert.ok(
    model.predictions.every(
      (match) =>
        Number.isFinite(match.probabilities.draw) &&
        match.probabilities.draw > 0,
    ),
  );
});
