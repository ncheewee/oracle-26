import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourcePath = path.join(root, "data/international-results.csv");
const worldCupPath = path.join(root, "outputs/worldcup.json");
const outputPath = path.join(root, "outputs/model.json");

const MODEL_START = "2000-01-01";
const VALIDATION_START = "2018-01-01";
const TEST_START = "2022-01-01";
const TOURNAMENT_START = "2026-06-11";
const AS_OF = new Date().toISOString().slice(0, 10);

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

function canonical(name) {
  return aliases[name] || name;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (char === "\n" && !quoted) {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows
    .filter((values) => values.length === headers.length)
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index]])),
    );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stateFor(states, name) {
  if (!states.has(name)) {
    states.set(name, {
      rating: 1500,
      attack: 1.35,
      defence: 1.35,
      matches: 0,
    });
  }
  return states.get(name);
}

function poisson(lambda, goals) {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

function poissonProbabilities(homeLambda, awayLambda) {
  const probabilities = [0, 0, 0];
  const scorelines = [];
  for (let home = 0; home <= 8; home += 1) {
    for (let away = 0; away <= 8; away += 1) {
      const probability = poisson(homeLambda, home) * poisson(awayLambda, away);
      const outcome = home > away ? 0 : home === away ? 1 : 2;
      probabilities[outcome] += probability;
      scorelines.push({ home, away, probability });
    }
  }
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return {
    probabilities: probabilities.map((value) => value / total),
    scoreline: scorelines.sort((a, b) => b.probability - a.probability)[0],
  };
}

function rawPrediction(states, match) {
  const home = stateFor(states, match.home);
  const away = stateFor(states, match.away);
  const homeAdvantage = match.neutral ? 0 : 65;
  const ratingDifference = home.rating + homeAdvantage - away.rating;
  const expectedHome = 1 / (1 + 10 ** (-ratingDifference / 400));
  const draw = clamp(0.27 - Math.abs(ratingDifference) / 1800, 0.16, 0.28);
  const elo = [
    expectedHome * (1 - draw),
    draw,
    (1 - expectedHome) * (1 - draw),
  ];

  const homeLambda = clamp(
    Math.sqrt(home.attack * away.defence) * (match.neutral ? 1 : 1.08),
    0.25,
    3.8,
  );
  const awayLambda = clamp(
    Math.sqrt(away.attack * home.defence) * (match.neutral ? 1 : 0.94),
    0.25,
    3.8,
  );
  const goalModel = poissonProbabilities(homeLambda, awayLambda);
  const probabilities = elo.map(
    (value, index) => value * 0.58 + goalModel.probabilities[index] * 0.42,
  );
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return {
    probabilities: probabilities.map((value) => value / total),
    scoreline: goalModel.scoreline,
    expectedGoals: [homeLambda, awayLambda],
    factors: {
      ratingDifference: Math.round(ratingDifference),
      homeRating: Math.round(home.rating),
      awayRating: Math.round(away.rating),
      homeMatches: home.matches,
      awayMatches: away.matches,
    },
  };
}

function update(states, match) {
  const home = stateFor(states, match.home);
  const away = stateFor(states, match.away);
  const homeAdvantage = match.neutral ? 0 : 65;
  const expectedHome = 1 / (1 + 10 ** (-(home.rating + homeAdvantage - away.rating) / 400));
  const result = match.homeScore > match.awayScore ? 1 : match.homeScore === match.awayScore ? 0.5 : 0;
  const importance = /FIFA World Cup$/.test(match.tournament)
    ? 42
    : /World Cup qualification/i.test(match.tournament)
      ? 30
      : /Friendly/i.test(match.tournament)
        ? 14
        : 24;
  const margin = Math.abs(match.homeScore - match.awayScore);
  const multiplier = margin <= 1 ? 1 : Math.log(margin + 1) * 1.25;
  const adjustment = importance * multiplier * (result - expectedHome);
  home.rating += adjustment;
  away.rating -= adjustment;

  const learningRate = home.matches < 8 ? 0.18 : 0.075;
  const awayLearningRate = away.matches < 8 ? 0.18 : 0.075;
  home.attack = home.attack * (1 - learningRate) + match.homeScore * learningRate;
  home.defence = home.defence * (1 - learningRate) + match.awayScore * learningRate;
  away.attack = away.attack * (1 - awayLearningRate) + match.awayScore * awayLearningRate;
  away.defence = away.defence * (1 - awayLearningRate) + match.homeScore * awayLearningRate;
  home.matches += 1;
  away.matches += 1;
}

function applyTemperature(probabilities, temperature) {
  const powered = probabilities.map((value) => value ** (1 / temperature));
  const total = powered.reduce((sum, value) => sum + value, 0);
  return powered.map((value) => value / total);
}

function outcome(match) {
  return match.homeScore > match.awayScore ? 0 : match.homeScore === match.awayScore ? 1 : 2;
}

function metrics(predictions) {
  let correct = 0;
  let logLoss = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, correct: 0 }));
  for (const item of predictions) {
    const actual = item.actual;
    const predicted = item.probabilities.indexOf(Math.max(...item.probabilities));
    if (predicted === actual) correct += 1;
    logLoss -= Math.log(Math.max(item.probabilities[actual], 1e-12));
    brier += item.probabilities.reduce(
      (sum, probability, index) => sum + (probability - (index === actual ? 1 : 0)) ** 2,
      0,
    ) / 3;
    const confidence = item.probabilities[predicted];
    const bin = bins[Math.min(9, Math.floor(confidence * 10))];
    bin.count += 1;
    bin.confidence += confidence;
    bin.correct += predicted === actual ? 1 : 0;
  }
  const ece = bins.reduce((sum, bin) => {
    if (!bin.count) return sum;
    return (
      sum +
      (bin.count / predictions.length) *
        Math.abs(bin.correct / bin.count - bin.confidence / bin.count)
    );
  }, 0);
  return {
    matches: predictions.length,
    accuracy: correct / predictions.length,
    logLoss: logLoss / predictions.length,
    brier: brier / predictions.length,
    calibrationError: ece,
  };
}

function evaluateTemperature(predictions) {
  let best = { temperature: 1, logLoss: Infinity };
  for (let temperature = 0.65; temperature <= 1.8; temperature += 0.025) {
    const adjusted = predictions.map((item) => ({
      ...item,
      probabilities: applyTemperature(item.probabilities, temperature),
    }));
    const score = metrics(adjusted).logLoss;
    if (score < best.logLoss) best = { temperature, logLoss: score };
  }
  return best.temperature;
}

function percentage(value) {
  return Math.round(value * 1000) / 10;
}

const csv = await fs.readFile(sourcePath, "utf8");
const rows = parseCsv(csv);
const matches = rows
  .filter(
    (row) =>
      row.date >= MODEL_START &&
      row.home_score !== "NA" &&
      row.away_score !== "NA" &&
      row.home_team &&
      row.away_team,
  )
  .map((row) => ({
    date: row.date,
    home: canonical(row.home_team),
    away: canonical(row.away_team),
    homeScore: Number(row.home_score),
    awayScore: Number(row.away_score),
    tournament: row.tournament,
    neutral: row.neutral === "TRUE",
  }))
  .sort((a, b) => a.date.localeCompare(b.date));

const states = new Map();
const validation = [];
const test = [];
for (const match of matches) {
  const prediction = rawPrediction(states, match);
  if (match.date >= VALIDATION_START && match.date < TEST_START) {
    validation.push({ probabilities: prediction.probabilities, actual: outcome(match) });
  } else if (match.date >= TEST_START && match.date < TOURNAMENT_START) {
    test.push({ probabilities: prediction.probabilities, actual: outcome(match) });
  }
  update(states, match);
}

const temperature = evaluateTemperature(validation);
const calibratedTest = test.map((item) => ({
  ...item,
  probabilities: applyTemperature(item.probabilities, temperature),
}));
const performance = metrics(calibratedTest);
const gates = {
  sampleSize: performance.matches >= 2000,
  accuracy: performance.accuracy >= 0.5,
  brier: performance.brier <= 0.2,
  calibration: performance.calibrationError <= 0.075,
};
const passed = Object.values(gates).every(Boolean);

const worldCup = JSON.parse(await fs.readFile(worldCupPath, "utf8"));
const tournamentTeams = worldCup.standings.flatMap((group) =>
  group.teams.map((team) => canonical(team.name)),
);
const teamSet = new Set(tournamentTeams);
const remainingRows = rows
  .filter(
    (row) =>
      row.date >= AS_OF &&
      row.home_score === "NA" &&
      teamSet.has(canonical(row.home_team)) &&
      teamSet.has(canonical(row.away_team)),
  )
  .map((row) => ({
    date: row.date,
    home: canonical(row.home_team),
    away: canonical(row.away_team),
    neutral: row.neutral === "TRUE",
    tournament: row.tournament,
  }));

const predictions = remainingRows.map((match) => {
  const raw = rawPrediction(states, match);
  const probabilities = applyTemperature(raw.probabilities, temperature);
  return {
    date: match.date,
    home: match.home,
    away: match.away,
    probabilities: {
      home: percentage(probabilities[0]),
      draw: percentage(probabilities[1]),
      away: percentage(probabilities[2]),
    },
    predictedScore: {
      home: raw.scoreline.home,
      away: raw.scoreline.away,
    },
    expectedGoals: {
      home: Math.round(raw.expectedGoals[0] * 100) / 100,
      away: Math.round(raw.expectedGoals[1] * 100) / 100,
    },
    confidence: percentage(Math.max(...probabilities)),
    factors: raw.factors,
  };
});

const contenders = [...new Set(tournamentTeams)]
  .map((name) => {
    const state = stateFor(states, name);
    return {
      name,
      rating: Math.round(state.rating),
      attack: Math.round(state.attack * 100) / 100,
      defence: Math.round(state.defence * 100) / 100,
      matches: state.matches,
    };
  })
  .sort((a, b) => b.rating - a.rating)
  .map((team, index) => ({ ...team, rank: index + 1 }));

const report = {
  generatedAt: new Date().toISOString(),
  asOf: AS_OF,
  status: passed ? "baseline_validated" : "validation_failed",
  model: {
    name: "Elo-Poisson Ensemble v1",
    description:
      "58% Elo outcome model and 42% recency-weighted Poisson goal model, temperature calibrated on 2018–2021 matches.",
    trainingStart: MODEL_START,
    validationWindow: `${VALIDATION_START} to 2021-12-31`,
    testWindow: `${TEST_START} to 2026-06-10`,
    temperature: Math.round(temperature * 1000) / 1000,
  },
  source: {
    name: "International football results from 1872",
    repository: "https://github.com/martj42/international_results",
    license: "CC0-1.0",
    rows: rows.length,
    caveat: "Community-compiled dataset cross-referenced from multiple football sources.",
  },
  performance: {
    matches: performance.matches,
    accuracy: percentage(performance.accuracy),
    brier: Math.round(performance.brier * 1000) / 1000,
    logLoss: Math.round(performance.logLoss * 1000) / 1000,
    calibrationError: percentage(performance.calibrationError),
  },
  gates,
  provisionalFavorite: contenders[0],
  contenders,
  predictions,
};

await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: report.status,
    performance: report.performance,
    predictions: predictions.length,
    favorite: report.provisionalFavorite,
  }),
);
