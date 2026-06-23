import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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

function sampleGroupScore(match) {
  const known = model.predictions.find(
    (prediction) =>
      prediction.home === match.home && prediction.away === match.away,
  );
  const lambdas = known
    ? [known.expectedGoals.home, known.expectedGoals.away]
    : expectedGoals(match.home, match.away);
  return [poisson(lambdas[0]), poisson(lambdas[1])];
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

const remainingGroupMatches = model.predictions.map((prediction) => ({
  home: prediction.home,
  away: prediction.away,
  group:
    worldCup.standings.find((group) =>
      group.teams.some((team) => canonical(team.name) === prediction.home),
    )?.group || null,
}));

if (
  remainingGroupMatches.length !==
  72 - worldCup.tournament.completedMatches
) {
  throw new Error(
    `Expected ${72 - worldCup.tournament.completedMatches} remaining group matches, ` +
      `got ${remainingGroupMatches.length}`,
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

const roundOf32 = [
  ["M73", "2A", "2B"],
  ["M74", "1E", "third"],
  ["M75", "1F", "2C"],
  ["M76", "1C", "2F"],
  ["M77", "1I", "third"],
  ["M78", "2E", "2I"],
  ["M79", "1A", "third"],
  ["M80", "1L", "third"],
  ["M81", "1D", "third"],
  ["M82", "1G", "third"],
  ["M83", "2K", "2L"],
  ["M84", "1H", "2J"],
  ["M85", "1B", "third"],
  ["M86", "1J", "2H"],
  ["M87", "1K", "third"],
  ["M88", "2D", "2G"],
];
const laterRounds = [
  [
    ["M89", "M74", "M77"],
    ["M90", "M73", "M75"],
    ["M91", "M76", "M78"],
    ["M92", "M79", "M80"],
    ["M93", "M83", "M84"],
    ["M94", "M81", "M82"],
    ["M95", "M86", "M88"],
    ["M96", "M85", "M87"],
  ],
  [
    ["M97", "M89", "M90"],
    ["M98", "M93", "M94"],
    ["M99", "M91", "M92"],
    ["M100", "M95", "M96"],
  ],
  [
    ["M101", "M97", "M98"],
    ["M102", "M99", "M100"],
  ],
  [["M104", "M101", "M102"]],
];

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
  const groups = completeGroups();
  const thirds = thirdPlaceKey(groups);
  const key = thirds.map((team) => team.group).join("");
  const thirdAllocation = allocation[key];
  if (!thirdAllocation) throw new Error(`Missing Annex C allocation for ${key}`);

  const slots = {};
  for (const [letter, teams] of groups) {
    slots[`1${letter}`] = teams[0].name;
    slots[`2${letter}`] = teams[1].name;
    slots[`3${letter}`] = teams[2].name;
    increment(teams[0].name, "groupWinner");
    increment(teams[0].name, "qualified");
    increment(teams[1].name, "qualified");
  }
  for (const team of thirds) increment(team.name, "qualified");

  const winners = {};
  for (const [matchId, homeSlot, awaySlot] of roundOf32) {
    const home = slots[homeSlot];
    const thirdSlot = thirdAllocation[homeSlot];
    const away = awaySlot === "third" ? slots[thirdSlot] : slots[awaySlot];
    const matchup = recordMatchup(matchId, home, away);
    matchup.count += 1;
    winners[matchId] = sampleKnockoutWinner(home, away);
    if (winners[matchId] === home) matchup.homeWins += 1;
    else matchup.awayWins += 1;
    increment(winners[matchId], "roundOf16");
  }

  const stageFields = ["quarterfinal", "semifinal", "final", "champion"];
  for (let stage = 0; stage < laterRounds.length; stage += 1) {
    for (const [matchId, homeSource, awaySource] of laterRounds[stage]) {
      const home = winners[homeSource];
      const away = winners[awaySource];
      const matchup = recordMatchup(matchId, home, away);
      matchup.count += 1;
      winners[matchId] = sampleKnockoutWinner(home, away);
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
    thirdPlaceCombinations: Object.keys(allocation).length,
    knockoutMatches: 31,
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
