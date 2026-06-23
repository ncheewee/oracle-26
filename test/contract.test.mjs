import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const contract = JSON.parse(fs.readFileSync("config/data-contract.json", "utf8"));

test("data contract contains no implicit numeric defaults", () => {
  const serialized = JSON.stringify(contract);
  assert.equal(serialized.includes('"default":0'), false);
  assert.equal(serialized.includes('"fallback":0'), false);
});

test("predictions are explicitly derived rather than sourced facts", () => {
  assert.ok(contract.derived.includes("match_probabilities"));
  assert.ok(contract.derived.includes("tournament_win_probability"));
  assert.equal(contract.facts.match.includes("match_probabilities"), false);
});
