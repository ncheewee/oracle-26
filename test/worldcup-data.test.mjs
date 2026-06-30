import assert from "node:assert/strict";
import test from "node:test";
import {
  groupStageProgress,
  isValidStandings,
} from "../lib/worldcup-data.mjs";

test("group-stage progress ignores completed knockout matches", () => {
  const fixtures = [
    ...Array.from({ length: 72 }, (_, index) => ({
      matchNumber: index + 1,
      status: "FT",
    })),
    { matchNumber: 73, status: "FT" },
    { matchNumber: 74, status: "Scheduled" },
  ];
  const progress = groupStageProgress(fixtures);
  assert.equal(progress.fixtures.length, 72);
  assert.equal(progress.completed.length, 72);
  assert.equal(progress.remaining.length, 0);
});

test("cached standings must contain all 12 four-team groups", () => {
  const standings = Array.from({ length: 12 }, (_, index) => ({
    group: `Group ${String.fromCharCode(65 + index)}`,
    teams: Array.from({ length: 4 }, (_, team) => ({
      name: `Team ${index}-${team}`,
    })),
  }));
  assert.equal(isValidStandings(standings), true);
  assert.equal(isValidStandings(standings.slice(0, 11)), false);
});
