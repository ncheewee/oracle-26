export function isValidStandings(standings) {
  return (
    Array.isArray(standings) &&
    standings.length === 12 &&
    standings.every(
      (group) =>
        /^Group [A-L]$/.test(group?.group || "") &&
        Array.isArray(group.teams) &&
        group.teams.length === 4 &&
        group.teams.every((team) => team?.name),
    )
  );
}

export function groupStageProgress(fixtures, groupMatchCount = 72) {
  const groupFixtures = fixtures.filter(
    (match) =>
      Number.isInteger(match.matchNumber) &&
      match.matchNumber >= 1 &&
      match.matchNumber <= groupMatchCount,
  );
  return {
    fixtures: groupFixtures,
    completed: groupFixtures.filter((match) => match.status === "FT"),
    remaining: groupFixtures.filter((match) => match.status !== "FT"),
  };
}
