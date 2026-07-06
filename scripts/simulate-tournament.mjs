import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { groupStageProgress } from "../lib/worldcup-data.mjs";

const root = process.cwd();
const worldCup = JSON.parse(
  await fs.readFile(path.join(root, "outputs/worldcup.json"), "utf8"),
);
const model = JSON.parse(
  await fs.readFile(path.join(root, "outputs/model.json"), "utf8"),
);
const allocation = JSON.parse(
  await fs.readFile(path.join(root, "config/third-place-allocation.json"), "utf8"),
).combinations;

const SIMULATIONS = Number(process.env.SIMULATIONS || 50_000);
const SEED = Number(process.env.SIMULATION_SEED || 20260623);

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
const reverseAliases = Object.fromEntries(
  Object.entries(aliases).map(([display, canonical]) => [canonical, display]),
);
const canonical = (name) => aliases[name] || name;
const displayName = (name) => reverseAliases[name] || name;

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);

function poisson(lambda) {
  const threshold = Math.exp(-lambda);
  let product = 1;
  let value = 0;
  do {
    value += 1;
    product *= random();
  } while (product > threshold && value < 12);
  return value - 1;
}

const strength = new Map(
  model.contenders.map((team) => [team.name, team]),
);
const allTeams = worldCup.standings.flatMap((group) =>
  group.teams.map((team) => canonical(team.name)),
);

function teamStrength(name) {
  return (
    strength.get(name) || {
      name,
      rating: 1500,
      attack: 1.25,
      defence: 1.25,
      matches: 0,
    }
  );
}

function expectedGoals(homeName, awayName) {
  const home = teamStrength(homeName);
  const away = teamStrength(awayName);
  return [
    Math.min(3.8, Math.max(0.25, Math.sqrt(home.attack * away.defence))),
    Math.min(3.8, Math.max(0.25, Math.sqrt(away.attack * home.defence))),
  ];
}

function findPrediction(match) {
  const known = model.predictions.find(
    (prediction) =>
      prediction.home === match.home && prediction.away === match.away,
  );
  if (known) {
    return {
      probabilities: [
        known.probabilities.home / 100,
        known.probabilities.draw / 100,
        known.probabilities.away / 100,
      ],
      expectedGoals: [known.expectedGoals.home, known.expectedGoals.away],
    };
  }
  const reversed = model.predictions.find(
    (prediction) =>
      prediction.home === match.away && prediction.away === match.home,
  );
  if (!reversed) return null;
  return {
    probabilities: [
      reversed.probabilities.away / 100,
      reversed.probabilities.draw / 100,
      reversed.probabilities.home / 100,
    ],
    expectedGoals: [reversed.expectedGoals.away, reversed.expectedGoals.home],
  };
}

function sampleOutcome(probabilities) {
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  const draw = random() * total;
  if (draw < probabilities[0]) return 0;
  if (draw < probabilities[0] + probabilities[1]) return 1;
  return 2;
}

function sampleScoreForOutcome(homeLambda, awayLambda, outcome) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const home = poisson(homeLambda);
    const away = poisson(awayLambda);
    if (
      (outcome === 0 && home > away) ||
      (outcome === 1 && home === away) ||
      (outcome === 2 && away > home)
    ) {
      return [home, away];
    }
  }
  if (outcome === 0) {
    const away = Math.max(0, poisson(awayLambda));
    return [away + 1, away];
  }
  if (outcome === 2) {
    const home = Math.max(0, poisson(homeLambda));
    return [home, home + 1];
  }
  const goals = Math.max(0, Math.round((homeLambda + awayLambda) / 2));
  return [goals, goals];
}

function sampleGroupScore(match) {
  const prediction = findPrediction(match);
  const lambdas = prediction
    ? prediction.expectedGoals
    : expectedGoals(match.home, match.away);
  const outcome = prediction
    ? sampleOutcome(prediction.probabilities)
    : sampleOutcomeFromGoals(lambdas[0], lambdas[1]);
  return sampleScoreForOutcome(lambdas[0], lambdas[1], outcome);
}

function sampleOutcomeFromGoals(homeLambda, awayLambda) {
  const homeGoals = poisson(homeLambda);
  const awayGoals = poisson(awayLambda);
  if (homeGoals > awayGoals) return 0;
  if (homeGoals === awayGoals) return 1;
  return 2;
}

function sampleKnockoutWinner(homeName, awayName) {
  const [homeLambda, awayLambda] = expectedGoals(homeName, awayName);
  let home = poisson(homeLambda);
  let away = poisson(awayLambda);
  if (home !== away) return home > away ? homeName : awayName;
  const homeStrength = teamStrength(homeName).rating;
  const awayStrength = teamStrength(awayName).rating;
  const homeChance = 1 / (1 + 10 ** (-(homeStrength - awayStrength) / 400));
  return random() < homeChance ? homeName : awayName;
}

const groupStage = groupStageProgress(worldCup.fixtures);
if (groupStage.fixtures.length !== 72) {
  throw new Error(`Expected 72 group-stage fixtures, got ${groupStage.fixtures.length}`);
}

const remainingGroupMatches = groupStage.remaining
  .map((match) => ({
    home: canonical(match.home.name),
    away: canonical(match.away.name),
    group: match.group,
  }));

if (groupStage.completed.length + remainingGroupMatches.length !== 72) {
  throw new Error(
    `Group-stage accounting mismatch: ${groupStage.completed.length} completed + ` +
      `${remainingGroupMatches.length} remaining`,
  );
}

function initialGroups() {
  return new Map(
    worldCup.standings.map((group) => [
      group.group.slice(-1),
      group.teams.map((team) => ({
        name: canonical(team.name),
        points: team.points,
        goalsFor: team.goalsFor,
        goalsAgainst: team.goalsAgainst,
        conduct: team.conductScore,
        random: random(),
      })),
    ]),
  );
}

function rankTeams(teams) {
  return [...teams].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor -
        b.goalsAgainst -
        (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      b.conduct - a.conduct ||
      b.random - a.random,
  );
}

function completeGroups() {
  const groups = initialGroups();
  for (const match of remainingGroupMatches) {
    const letter = match.group?.slice(-1);
    const table = groups.get(letter);
    if (!table) throw new Error(`Missing group for ${match.home} v ${match.away}`);
    const home = table.find((team) => team.name === match.home);
    const away = table.find((team) => team.name === match.away);
    if (!home || !away) {
      throw new Error(`Could not join ${match.home} v ${match.away} to Group ${letter}`);
    }
    const [homeGoals, awayGoals] = sampleGroupScore(match);
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;
    if (homeGoals > awayGoals) home.points += 3;
    else if (awayGoals > homeGoals) away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }
  return new Map(
    [...groups].map(([letter, teams]) => [letter, rankTeams(teams)]),
  );
}

function thirdPlaceKey(groups) {
  const thirds = [...groups].map(([letter, teams]) => ({
    ...teams[2],
    group: letter,
  }));
  thirds.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor -
        b.goalsAgainst -
        (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      b.conduct - a.conduct ||
      b.random - a.random,
  );
  return thirds.slice(0, 8).sort((a, b) => a.group.localeCompare(b.group));
}

const knockoutRoundNumbers = [
  Array.from({ length: 16 }, (_, index) => index + 73),
  Array.from({ length: 8 }, (_, index) => index + 89),
  Array.from({ length: 4 }, (_, index) => index + 97),
  [101, 102],
  [104],
];
const knockoutRounds = knockoutRoundNumbers.map((numbers) =>
  numbers.map((number) => {
    const fixture = worldCup.fixtures.find(
      (match) => match.matchNumber === number,
    );
    if (!fixture) throw new Error(`Missing FIFA knockout fixture M${number}`);
    return fixture;
  }),
);
const stageFields = ["roundOf16", "quarterfinal", "semifinal", "final", "champion"];

function placeholderSource(name) {
  const match = String(name || "").match(
    /^W(?:inner)?\s*(?:Match)?\s*(\d+)$/i,
  );
  return match ? `M${match[1]}` : null;
}

function resolveParticipant(participant, winners) {
  const name = canonical(participant?.name);
  if (strength.has(name)) return name;
  const source = placeholderSource(participant?.name);
  if (source && winners[source]) return winners[source];
  throw new Error(`Could not resolve knockout participant ${participant?.name}`);
}

function completedWinner(match, nextRound) {
  if (match.status !== "FT") return null;
  const home = canonical(match.home.name);
  const away = canonical(match.away.name);
  if (match.homeScore > match.awayScore) return home;
  if (match.awayScore > match.homeScore) return away;

  const downstreamTeams = (nextRound || []).flatMap((fixture) => [
    canonical(fixture.home?.name),
    canonical(fixture.away?.name),
  ]);
  const inferred = [home, away].find((team) => downstreamTeams.includes(team));
  if (inferred) return inferred;
  throw new Error(
    `Could not infer shootout winner for completed draw M${match.matchNumber}`,
  );
}

const counters = new Map(
  allTeams.map((name) => [
    name,
    {
      qualified: 0,
      roundOf16: 0,
      quarterfinal: 0,
      semifinal: 0,
      final: 0,
      champion: 0,
      groupWinner: 0,
    },
  ]),
);
const matchupCounters = new Map();

function increment(team, field) {
  const counter = counters.get(team);
  if (counter) counter[field] += 1;
}

function recordMatchup(matchId, home, away) {
  const key = `${matchId}|${home}|${away}`;
  if (!matchupCounters.has(key)) {
    matchupCounters.set(key, { count: 0, homeWins: 0, awayWins: 0 });
  }
  return matchupCounters.get(key);
}

for (let iteration = 0; iteration < SIMULATIONS; iteration += 1) {
  const winners = {};
  for (const group of worldCup.standings) {
    const winner = canonical(group.teams.find((team) => team.position === 1)?.name);
    if (winner) increment(winner, "groupWinner");
  }
  for (const match of knockoutRounds[0]) {
    increment(canonical(match.home.name), "qualified");
    increment(canonical(match.away.name), "qualified");
  }

  for (let stage = 0; stage < knockoutRounds.length; stage += 1) {
    const nextRound = knockoutRounds[stage + 1] || [];
    for (const match of knockoutRounds[stage]) {
      const matchId = `M${match.matchNumber}`;
      const home = resolveParticipant(match.home, winners);
      const away = resolveParticipant(match.away, winners);
      const matchup = recordMatchup(matchId, home, away);
      matchup.count += 1;
      winners[matchId] = completedWinner(match, nextRound) || sampleKnockoutWinner(home, away);
      if (winners[matchId] === home) matchup.homeWins += 1;
      else matchup.awayWins += 1;
      increment(winners[matchId], stageFields[stage]);
    }
  }
}

function percent(count) {
  return Math.round((count / SIMULATIONS) * 1000) / 10;
}

const teams = [...counters.entries()]
  .map(([name, counts]) => ({
    name: displayName(name),
    canonicalName: name,
    rating: teamStrength(name).rating,
    probabilities: Object.fromEntries(
      Object.entries(counts).map(([field, count]) => [field, percent(count)]),
    ),
  }))
  .sort(
    (a, b) =>
      b.probabilities.champion - a.probabilities.champion ||
      b.rating - a.rating,
  )
  .map((team, index) => ({ rank: index + 1, ...team }));

const projectedMatches = {};
for (const [key, counts] of matchupCounters) {
  const [matchId, home, away] = key.split("|");
  if (
    !projectedMatches[matchId] ||
    counts.count > projectedMatches[matchId].count
  ) {
    projectedMatches[matchId] = {
      matchId,
      home: displayName(home),
      away: displayName(away),
      probability: percent(counts.count),
      homeWinProbability:
        Math.round((counts.homeWins / counts.count) * 1000) / 10,
      awayWinProbability:
        Math.round((counts.awayWins / counts.count) * 1000) / 10,
      predictedWinner:
        counts.homeWins >= counts.awayWins
          ? displayName(home)
          : displayName(away),
      count: counts.count,
    };
  }
}
for (const match of Object.values(projectedMatches)) delete match.count;

const titleCount = [...counters.values()].reduce(
  (sum, counts) => sum + counts.champion,
  0,
);
if (titleCount !== SIMULATIONS) {
  throw new Error(
    `Champion counts sum to ${titleCount}, expected ${SIMULATIONS}`,
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  status: "tournament_simulation_validated",
  simulations: SIMULATIONS,
  seed: SEED,
  format: {
    groups: 12,
    advancing: "Top two from each group plus eight best third-placed teams",
    groupStageOutcomes:
      "Verified group standings and completed knockout results are locked; only unresolved matches are sampled.",
    thirdPlaceCombinations: Object.keys(allocation).length,
    knockoutMatches: 31,
    conditionedOnCompletedKnockoutResults: true,
  },
  source: {
    allocation: "FIFA World Cup 2026 Regulations Annex C",
    currentState: worldCup.source,
    matchModel: model.model,
  },
  winner: teams[0],
  teams,
  projectedMatches,
};

await fs.writeFile(
  path.join(root, "outputs/tournament-simulation.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: report.status,
    simulations: SIMULATIONS,
    winner: report.winner,
    topFive: teams.slice(0, 5).map((team) => ({
      name: team.name,
      champion: team.probabilities.champion,
    })),
  }),
);
