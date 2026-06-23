import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("validated model output contains no fabricated title probability", () => {
  if (!fs.existsSync("outputs/model.json")) return;
  const model = JSON.parse(fs.readFileSync("outputs/model.json", "utf8"));
  assert.equal("winProbability" in model.provisionalFavorite, false);
  assert.ok(["baseline_validated", "validation_failed"].includes(model.status));
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
