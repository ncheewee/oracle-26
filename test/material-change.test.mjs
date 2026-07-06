import assert from "node:assert/strict";
import test from "node:test";
import { materiallyEqual } from "../lib/material-change.mjs";

test("generated timestamps do not create material changes", () => {
  assert.equal(
    materiallyEqual(
      "outputs/worldcup.json",
      { generatedAt: "one", fixtures: [{ status: "FT" }] },
      { generatedAt: "two", fixtures: [{ status: "FT" }] },
    ),
    true,
  );
});

test("new results and odds remain material changes", () => {
  assert.equal(
    materiallyEqual(
      "outputs/worldcup.json",
      { fixtures: [{ status: "Scheduled" }] },
      { fixtures: [{ status: "FT" }] },
    ),
    false,
  );
  assert.equal(
    materiallyEqual(
      "outputs/market-odds.json",
      { championship: [{ team: "France", decimalOdds: 3 }] },
      { championship: [{ team: "France", decimalOdds: 2.3 }] },
    ),
    false,
  );
});

test("duplicate prediction-history heartbeats are timestamp-only", () => {
  const snapshot = { winner: { name: "France", champion: 20 } };
  assert.equal(
    materiallyEqual(
      "outputs/prediction-history.json",
      { snapshots: [{ generatedAt: "one", ...snapshot }] },
      {
        snapshots: [
          { generatedAt: "one", ...snapshot },
          { generatedAt: "two", ...snapshot },
        ],
      },
    ),
    true,
  );
});
