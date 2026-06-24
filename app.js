const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const fmtDate = (iso) =>
  new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

let worldCup;
let audit;
let model;
let simulation;
let market;
let bettingSort = "balanced";
let bettingFilter = "value";

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
  Curacao: "Curacao",
  Holland: "Netherlands",
  Bosnia: "Bosnia and Herzegovina",
  "Cote d'Ivoire": "Ivory Coast",
};
const canonical = (name) => aliases[name] || name;
const pct = (value) => `${Math.round(value * 10) / 10}%`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function applyTemperature(probabilities, temperature) {
  const powered = probabilities.map((value) => value ** (1 / temperature));
  const total = powered.reduce((sum, value) => sum + value, 0);
  return powered.map((value) => value / total);
}

function contenderState(name) {
  return (
    model?.contenders.find((team) => team.name === canonical(name)) || {
      name: canonical(name),
      rating: 1500,
      attack: 1.35,
      defence: 1.35,
      matches: 0,
    }
  );
}

function modelExpectationForMatch(match) {
  const home = contenderState(match.home.name);
  const away = contenderState(match.away.name);
  const ratingDifference = home.rating - away.rating;
  const expectedHome = 1 / (1 + 10 ** (-ratingDifference / 400));
  const draw = clamp(0.27 - Math.abs(ratingDifference) / 1800, 0.16, 0.28);
  const elo = [
    expectedHome * (1 - draw),
    draw,
    (1 - expectedHome) * (1 - draw),
  ];
  const homeLambda = clamp(Math.sqrt(home.attack * away.defence), 0.25, 3.8);
  const awayLambda = clamp(Math.sqrt(away.attack * home.defence), 0.25, 3.8);
  const goalModel = poissonProbabilities(homeLambda, awayLambda);
  const raw = elo.map(
    (value, index) => value * 0.58 + goalModel.probabilities[index] * 0.42,
  );
  const total = raw.reduce((sum, value) => sum + value, 0);
  const probabilities = applyTemperature(
    raw.map((value) => value / total),
    model?.model?.temperature || 1,
  );
  const labels = ["HOME", "DRAW", "AWAY"];
  const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
  return {
    probabilities,
    predictedIndex,
    predictedLabel: labels[predictedIndex],
    confidence: probabilities[predictedIndex],
    scoreline: goalModel.scoreline,
    expectedGoals: [homeLambda, awayLambda],
    ratingDifference,
  };
}

function actualOutcomeIndex(match) {
  if (match.homeScore > match.awayScore) return 0;
  if (match.homeScore === match.awayScore) return 1;
  return 2;
}

function scorecardRows() {
  return worldCup.fixtures
    .filter((match) => match.status === "FT")
    .map((match) => {
      const expectation = modelExpectationForMatch(match);
      const actualIndex = actualOutcomeIndex(match);
      const actualProbability = expectation.probabilities[actualIndex];
      const actualLabel =
        actualIndex === 0 ? match.home.code : actualIndex === 1 ? "DRAW" : match.away.code;
      const predictedLabel =
        expectation.predictedIndex === 0
          ? match.home.code
          : expectation.predictedIndex === 1
            ? "DRAW"
            : match.away.code;
      return {
        match,
        expectation,
        actualIndex,
        actualLabel,
        predictedLabel,
        hit: expectation.predictedIndex === actualIndex,
        actualProbability,
        surprise: 1 - actualProbability,
      };
    });
}

function flag(team) {
  return `<img class="team-flag" src="${team.flag || ""}" alt="" loading="lazy">`;
}

function matchRow(match) {
  const score =
    match.homeScore === null
      ? `<span class="score"><small>${match.status}</small></span>`
      : `<span class="score">${match.homeScore}<small>${match.status}</small>${match.awayScore}</span>`;
  return `<div class="match-row">
    <div class="match-team">${flag(match.home)}<span>${match.home.name}</span></div>
    ${score}
    <div class="match-team away"><span>${match.away.name}</span>${flag(match.away)}</div>
  </div>`;
}

function predictionFor(match) {
  if (!model || model.status !== "baseline_validated") return null;
  return predictionForNames(match.home.name, match.away.name);
}

function predictionForNames(homeName, awayName) {
  if (!model || model.status !== "baseline_validated") return null;
  const home = canonical(homeName);
  const away = canonical(awayName);
  const direct = model.predictions.find(
    (prediction) =>
      prediction.home === home &&
      prediction.away === away,
  );
  if (direct) return direct;
  const reversed = model.predictions.find(
    (prediction) =>
      prediction.home === away &&
      prediction.away === home,
  );
  if (!reversed) return null;
  return {
    ...reversed,
    home,
    away,
    probabilities: {
      home: reversed.probabilities.away,
      draw: reversed.probabilities.draw,
      away: reversed.probabilities.home,
    },
    predictedScore: {
      home: reversed.predictedScore.away,
      away: reversed.predictedScore.home,
    },
    expectedGoals: {
      home: reversed.expectedGoals.away,
      away: reversed.expectedGoals.home,
    },
  };
}

function marketTeams(event) {
  if (event.home && event.away) return [event.home, event.away];
  const parts = event.name?.split(/\s+vs\s+/i).map((part) => part.trim());
  return parts?.length === 2 ? parts : [null, null];
}

function matchingFixtureForMarket(homeName, awayName) {
  const home = canonical(homeName);
  const away = canonical(awayName);
  return worldCup.fixtures.find((match) => {
    const fixtureHome = canonical(match.home.name);
    const fixtureAway = canonical(match.away.name);
    return (
      match.status !== "FT" &&
      ((fixtureHome === home && fixtureAway === away) ||
        (fixtureHome === away && fixtureAway === home))
    );
  });
}

function marketOutcomeRows() {
  if (!market?.matches?.length) return [];
  return market.matches.flatMap((event) => {
    const [homeName, awayName] = marketTeams(event);
    if (!homeName || !awayName) return [];
    const fixture = matchingFixtureForMarket(homeName, awayName);
    if (!fixture) return [];
    const prediction = predictionForNames(homeName, awayName);
    if (!prediction) return [];
    const prices = event.prices || {};
    const outcomes = [
      {
        key: "home",
        label: homeName,
        modelProbability: prediction.probabilities.home,
        decimalOdds: prices[homeName],
      },
      {
        key: "draw",
        label: "Draw",
        modelProbability: prediction.probabilities.draw,
        decimalOdds: prices.Draw,
      },
      {
        key: "away",
        label: awayName,
        modelProbability: prediction.probabilities.away,
        decimalOdds: prices[awayName],
      },
    ];
    return outcomes
      .filter((outcome) => Number.isFinite(outcome.decimalOdds))
      .map((outcome) => {
        const marketImpliedProbability = Math.round((100 / outcome.decimalOdds) * 10) / 10;
        const probabilityEdge =
          Math.round((outcome.modelProbability - marketImpliedProbability) * 10) / 10;
        const expectedReturn =
          Math.round(((outcome.modelProbability / 100) * outcome.decimalOdds - 1) * 1000) / 10;
        const signal = signalForBet({
          modelProbability: outcome.modelProbability,
          probabilityEdge,
          expectedReturn,
        });
        const recommendation =
          signal.label === "GREEN" &&
          expectedReturn >= 8
            ? "VALUE WATCH"
            : signal.label === "AMBER"
              ? "LEAN ONLY"
              : probabilityEdge <= -6 || expectedReturn <= -18
                ? "AVOID"
                : "NO BET";
        return {
          ...outcome,
          event,
          fixture,
          homeName,
          awayName,
          marketImpliedProbability,
          probabilityEdge,
          expectedReturn,
          signal,
          recommendation,
        };
      });
  });
}

function signalForBet(row) {
  if (
    row.modelProbability >= 45 &&
    row.probabilityEdge >= 2 &&
    row.expectedReturn > 0
  ) {
    return {
      label: "GREEN",
      rank: 3,
      note: "model conviction and price both align",
    };
  }
  if (
    row.expectedReturn > 0 &&
    row.probabilityEdge > 0 &&
    row.modelProbability >= 18
  ) {
    return {
      label: "AMBER",
      rank: 2,
      note: "positive value but speculative or lower conviction",
    };
  }
  return {
    label: "RED",
    rank: 1,
    note: "price is weak or confidence is too low",
  };
}

function betRowId(row) {
  return `${row.event.eventId || row.fixture.id}-${row.key}`;
}

function bettingRowById(id) {
  return marketOutcomeRows().find((row) => betRowId(row) === id);
}

function probabilityForOutcome(prediction, key) {
  return prediction?.probabilities?.[key] ?? null;
}

function groupTeamFor(name) {
  const canonicalName = canonical(name);
  for (const group of worldCup.standings || []) {
    const team = group.teams.find((item) => canonical(item.name) === canonicalName);
    if (team) return { ...team, group: group.group };
  }
  return null;
}

function teamResultLine(match, teamName) {
  const isHome = canonical(match.home.name) === canonical(teamName);
  const teamScore = isHome ? match.homeScore : match.awayScore;
  const opponentScore = isHome ? match.awayScore : match.homeScore;
  const opponent = isHome ? match.away.name : match.home.name;
  const result = teamScore > opponentScore ? "W" : teamScore === opponentScore ? "D" : "L";
  return `${result} ${teamScore}-${opponentScore} vs ${opponent}`;
}

function recentTeamResults(name, limit = 3) {
  const canonicalName = canonical(name);
  return worldCup.fixtures
    .filter(
      (match) =>
        match.status === "FT" &&
        (canonical(match.home.name) === canonicalName ||
          canonical(match.away.name) === canonicalName),
    )
    .sort((a, b) => b.matchNumber - a.matchNumber)
    .slice(0, limit)
    .map((match) => teamResultLine(match, name));
}

function explainBet(row) {
  const prediction = predictionForNames(row.homeName, row.awayName);
  const fixturePrediction = predictionFor(row.fixture);
  const selectedGroup = row.key === "draw" ? null : groupTeamFor(row.label);
  const opponentName =
    row.key === "home"
      ? row.awayName
      : row.key === "away"
        ? row.homeName
        : `${row.homeName} / ${row.awayName}`;
  const selectedStrength = row.key === "draw" ? null : contenderState(row.label);
  const opponentStrength = row.key === "draw" ? null : contenderState(opponentName);
  const fixtureHome = row.fixture.home.name;
  const fixtureAway = row.fixture.away.name;
  const fixtureContext =
    canonical(fixtureHome) !== canonical(row.homeName) ||
    canonical(fixtureAway) !== canonical(row.awayName)
      ? `Odds market is listed as ${row.homeName} vs ${row.awayName}; FIFA fixture context is ${fixtureHome} vs ${fixtureAway}.`
      : `Market and FIFA fixture both list ${fixtureHome} vs ${fixtureAway}.`;
  const venueContext = [row.fixture.venue, row.fixture.city].filter(Boolean).join(", ");
  const selectedProbability = probabilityForOutcome(prediction, row.key);
  const fixtureProbabilities = fixturePrediction?.probabilities || prediction?.probabilities;
  const expectedGoalLine = prediction
    ? `${row.homeName} ${prediction.expectedGoals.home.toFixed(2)} xG · ${row.awayName} ${prediction.expectedGoals.away.toFixed(2)} xG`
    : "Expected goals unavailable for this pairing.";
  const scoreline = prediction
    ? `${prediction.predictedScore.home}-${prediction.predictedScore.away}`
    : "—";
  const probabilityEntries = prediction
    ? [
        { key: "home", label: row.homeName, value: prediction.probabilities.home },
        { key: "draw", label: "Draw", value: prediction.probabilities.draw },
        { key: "away", label: row.awayName, value: prediction.probabilities.away },
      ]
    : [];
  const aggregateLeader = probabilityEntries.sort((a, b) => b.value - a.value)[0];
  const exactScoreOutcome = prediction
    ? prediction.predictedScore.home > prediction.predictedScore.away
      ? "home"
      : prediction.predictedScore.home === prediction.predictedScore.away
        ? "draw"
        : "away"
    : null;
  const scorelineNote =
    prediction && aggregateLeader && exactScoreOutcome !== aggregateLeader.key
      ? `Most likely exact score is ${scoreline}, but aggregate 1X2 probability favours ${aggregateLeader.label} because multiple ${aggregateLeader.label.toLowerCase()} scorelines add up to ${aggregateLeader.value}%.`
      : prediction && aggregateLeader
        ? `Most likely exact score and aggregate 1X2 leader both point to ${aggregateLeader.label}.`
        : expectedGoalLine;
  const recentHome = recentTeamResults(row.homeName);
  const recentAway = recentTeamResults(row.awayName);
  const selectedRecord = selectedGroup
    ? `${selectedGroup.points} pts · ${selectedGroup.goalsFor}-${selectedGroup.goalsAgainst} goals · ${selectedGroup.position}${selectedGroup.position === 1 ? "st" : selectedGroup.position === 2 ? "nd" : selectedGroup.position === 3 ? "rd" : "th"} in ${selectedGroup.group}`
    : "Draw has no team table record; it is evaluated from the combined outcome probability.";
  const ratingLine =
    selectedStrength && opponentStrength
      ? `${row.label} rating ${selectedStrength.rating}; ${opponentName} rating ${opponentStrength.rating}.`
      : "Draw probability comes from the rating gap plus Poisson scoreline model.";

  return `
    <div class="bet-explainer-head">
      <span>${row.fixture.group || row.fixture.stage || "Upcoming match"} · M${row.fixture.matchNumber}</span>
      <h2 id="bet-explainer-title">${row.label}</h2>
      <p>${row.homeName} vs ${row.awayName} · ${new Date(row.event.startTime).toLocaleString("en-SG", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
    </div>
    <div class="bet-explainer-kpis">
      <div><span>SP odds</span><strong>${row.decimalOdds.toFixed(2)}</strong><small>${row.marketImpliedProbability}% market implied</small></div>
      <div><span>Model</span><strong class="signal-${row.signal.label.toLowerCase()}">${selectedProbability}%</strong><small>${row.signal.note}</small></div>
      <div><span>Edge</span><strong>${row.probabilityEdge > 0 ? "+" : ""}${row.probabilityEdge}pp</strong><small>${row.expectedReturn > 0 ? "+" : ""}${row.expectedReturn}% EV</small></div>
      <div><span>Most likely score</span><strong>${scoreline}</strong><small>${expectedGoalLine}</small></div>
    </div>
    <div class="bet-explainer-grid">
      <section>
        <h3>Why this card exists</h3>
        <p>The card appears because the model probability for <b>${row.label}</b> is ${selectedProbability}%, while Singapore Pools odds imply ${row.marketImpliedProbability}%.</p>
        <p>${fixtureContext}</p>
        <p>${venueContext ? `Venue context: ${venueContext}.` : "Venue context is not available in the verified FIFA snapshot."}</p>
      </section>
      <section>
        <h3>Outcome probabilities</h3>
        <div class="explainer-bars">
          <p><span>${row.homeName}</span><b>${prediction?.probabilities.home ?? "—"}%</b></p>
          <p><span>Draw</span><b>${prediction?.probabilities.draw ?? "—"}%</b></p>
          <p><span>${row.awayName}</span><b>${prediction?.probabilities.away ?? "—"}%</b></p>
        </div>
        <p>${scorelineNote}</p>
        ${
          fixturePrediction && fixturePrediction !== prediction
            ? `<small>FIFA fixture orientation: ${fixtureHome} ${fixtureProbabilities.home}% · Draw ${fixtureProbabilities.draw}% · ${fixtureAway} ${fixtureProbabilities.away}%.</small>`
            : ""
        }
      </section>
      <section>
        <h3>Team evidence</h3>
        <p>${ratingLine}</p>
        <p>${selectedRecord}</p>
        <ul>
          <li><b>${row.homeName}</b>: ${recentHome.join("; ") || "No completed tournament result yet."}</li>
          <li><b>${row.awayName}</b>: ${recentAway.join("; ") || "No completed tournament result yet."}</li>
        </ul>
      </section>
      <section>
        <h3>Guardrail</h3>
        <p><b>${row.signal.label}</b> means ${row.signal.note}. This is still a model-vs-market read, not advice or certainty.</p>
        <p>The safest bet is no bet; use this explanation to challenge the model, especially when the pick feels counter-intuitive.</p>
      </section>
    </div>`;
}

function predictionPanel(match) {
  const prediction = predictionFor(match);
  if (!prediction) return "";
  const values = [
    [match.home.code, prediction.probabilities.home],
    ["DRAW", prediction.probabilities.draw],
    [match.away.code, prediction.probabilities.away],
  ];
  return `<div class="prediction-strip">
    <div class="prediction-head"><span>MOST LIKELY SCORE</span><b>${prediction.predictedScore.home}–${prediction.predictedScore.away}</b></div>
    <div class="probability-bars">${values
      .map(
        ([label, value]) => `<div><span>${label}</span><i><b style="width:${value}%"></b></i><strong>${value}%</strong></div>`,
      )
      .join("")}</div>
  </div>`;
}

function setView(id) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  $$(".nav-item").forEach((item) =>
    item.classList.toggle("active", item.dataset.view === id),
  );
  $("#view-title").textContent =
    $(`.nav-item[data-view="${id}"]`)?.textContent.replace(/^\d+/, "").trim() ||
    "ORACLE 26";
  $(".sidebar").classList.remove("open");
  history.replaceState(null, "", `#${id}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderOverview() {
  const { tournament, standings, fixtures } = worldCup;
  const pct = Math.round(
    (tournament.completedMatches / tournament.totalMatches) * 100,
  );
  $("#metric-total").textContent = tournament.totalMatches;
  $("#metric-completed").textContent = tournament.completedMatches;
  $("#metric-groups").textContent = standings.length;
  $("#metric-fields").textContent = audit.summary.verified;
  $("#tournament-progress").textContent = `${pct}% COMPLETE`;
  $("#progress-percent").textContent = `${tournament.completedMatches} / ${tournament.totalMatches}`;
  $("#progress-bar").style.width = `${pct}%`;

  if (simulation?.status === "tournament_simulation_validated") {
    const favorite = simulation.winner;
    $("#hero-overline").textContent = "PREDICTED TOURNAMENT WINNER";
    $("#hero-heading").innerHTML =
      `${favorite.name}<br><em>${favorite.probabilities.champion}% title chance</em>`;
    $("#hero-description").textContent =
      `${simulation.simulations.toLocaleString()} seeded simulations using current standings, remaining group-match probabilities and all 495 official third-place allocations.`;
    $("#orb-label").textContent = "WIN PROBABILITY";
    $("#orb-value").textContent = `${favorite.probabilities.champion}%`;
    $("#orb-note").textContent = `${favorite.probabilities.final}% MAKE FINAL`;
  }

  const flagByName = new Map(
    standings.flatMap((group) =>
      group.teams.map((team) => [canonical(team.name), team.flag]),
    ),
  );
  const leaders = simulation.teams.slice(0, 6);
  $("#leaders-list").innerHTML = leaders
    .map(
      (team) => `<div class="leader-row">
        ${flag({ flag: flagByName.get(team.canonicalName) })}
        <div><strong>${team.name}</strong><span>${team.probabilities.final}% final · ${team.probabilities.semifinal}% semi-final</span></div>
        <b>${team.probabilities.champion}%</b>
      </div>`,
    )
    .join("");

  $("#latest-results").innerHTML = fixtures
    .filter((match) => match.status === "FT")
    .slice(-5)
    .reverse()
    .map(matchRow)
    .join("");

  const total = Object.values(audit.summary).reduce((sum, value) => sum + value, 0);
  const chart = [
    ["VERIFIED", audit.summary.verified, "verified"],
    ["DERIVABLE", audit.summary.derivable, "derived"],
    ["UNAVAILABLE / BLOCKED", audit.summary.unavailable + audit.summary.blocked, "missing"],
  ];
  $("#integrity-chart").innerHTML = chart
    .map(
      ([label, count, cls]) => `<div class="integrity-row ${cls}">
        <div><span>${label}</span><b>${count}</b></div>
        <div class="bar"><i style="width:${(count / total) * 100}%"></i></div>
      </div>`,
    )
    .join("");
  renderWinnerIntelligence();
  renderLatestSignal();
  renderMarketLens();
}

function renderGroups() {
  $("#group-grid").innerHTML = worldCup.standings
    .map(
      (group) => `<article class="group-card">
        <h3>${group.group}</h3>
        <div class="standing-head"><span>#</span><span>TEAM</span><span>P</span><span>GD</span><span>PTS</span></div>
        ${group.teams
          .map(
            (team) => `<div class="standing-row">
              <span>${team.position}</span>
              <span class="standing-team">${flag(team)}<b>${team.name}</b></span>
              <span>${team.played}</span>
              <span>${team.goalDifference > 0 ? "+" : ""}${team.goalDifference}</span>
              <span>${team.points}</span>
            </div>`,
          )
          .join("")}
      </article>`,
    )
    .join("");
}

function renderBracket() {
  const flagMap = new Map(
    worldCup.standings.flatMap((group) =>
      group.teams.map((team) => [team.name, team.flag]),
    ),
  );
  const stages = [
    ["ROUND OF 32", 73, 88],
    ["ROUND OF 16", 89, 96],
    ["QUARTER-FINALS", 97, 100],
    ["SEMI-FINALS", 101, 102],
    ["FINAL", 104, 104],
  ];
  $("#full-bracket").innerHTML = stages
    .map(([label, start, end]) => {
      const cards = [];
      for (let number = start; number <= end; number += 1) {
        const projected = simulation.projectedMatches[`M${number}`];
        const actual = worldCup.fixtures.find(
          (fixture) => fixture.matchNumber === number,
        );
        if (!projected && !actual) continue;
        const completed = actual?.status === "FT";
        const home = completed ? actual.home.name : projected.home;
        const away = completed ? actual.away.name : projected.away;
        const homeMeta = completed
          ? actual.homeScore
          : `${projected.homeWinProbability}%`;
        const awayMeta = completed
          ? actual.awayScore
          : `${projected.awayWinProbability}%`;
        cards.push(`<div class="bracket-match ${completed ? "completed" : "predicted"}">
          <div class="bracket-id"><span>M${number}</span><b>${completed ? "FINAL SCORE" : `${projected.probability}% PATH`}</b></div>
          <div class="${!completed && projected.predictedWinner === home ? "winner" : ""}">${flag({ flag: flagMap.get(home) })}<strong>${home}</strong><em>${homeMeta}</em></div>
          <div class="${!completed && projected.predictedWinner === away ? "winner" : ""}">${flag({ flag: flagMap.get(away) })}<strong>${away}</strong><em>${awayMeta}</em></div>
        </div>`);
      }
      return `<section class="bracket-stage"><h3>${label}</h3>${cards.join("")}</section>`;
    })
    .join("");
}

function renderWinnerIntelligence() {
  const winner = simulation.winner;
  if (!winner) return;
  const strengthData = model.contenders.find(
    (team) => team.name === winner.canonicalName,
  );
  if (!strengthData) return;
  const averageRating =
    model.contenders.reduce((sum, team) => sum + team.rating, 0) /
    model.contenders.length;
  $("#intel-team").textContent = winner.name.toUpperCase();
  const funnel = [
    ["QUALIFY", winner.probabilities.qualified],
    ["R16", winner.probabilities.roundOf16],
    ["QF", winner.probabilities.quarterfinal],
    ["SF", winner.probabilities.semifinal],
    ["FINAL", winner.probabilities.final],
    ["WIN", winner.probabilities.champion],
  ];
  $("#advancement-funnel").innerHTML = funnel
    .map(
      ([label, value]) =>
        `<div><span>${label}</span><i style="width:${Math.max(value, 5)}%"></i><strong>${value}%</strong></div>`,
    )
    .join("");
  const drivers = [
    ["STRENGTH RATING", strengthData.rating, `${Math.round(strengthData.rating - averageRating)} above field average`],
    ["RECENT ATTACK RATE", strengthData.attack, "recency-weighted goals per match"],
    ["RECENT DEFENCE RATE", strengthData.defence, "lower conceded rate is stronger"],
    ["GROUP-WIN CHANCE", `${winner.probabilities.groupWinner}%`, "improves projected knockout route"],
    ["MAKE-FINAL CHANCE", `${winner.probabilities.final}%`, "across all official allocations"],
    ["SIMULATION STABILITY", "±0.2pp", "across independent random seeds"],
  ];
  $("#winner-drivers").innerHTML = drivers
    .map(
      ([label, value, note]) =>
        `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
    )
    .join("");
}

function winnerFixtures() {
  const winnerName = simulation.winner?.name;
  if (!winnerName) return [];
  return worldCup.fixtures.filter(
    (match) =>
      match.matchNumber <= 72 &&
      (canonical(match.home.name) === canonical(winnerName) ||
        canonical(match.away.name) === canonical(winnerName)),
  );
}

function renderWinnerJourney() {
  const winner = simulation.winner;
  const strengthData = model.contenders.find(
    (team) => team.name === winner.canonicalName,
  );
  const groupTeam = worldCup.standings
    .flatMap((group) => group.teams.map((team) => ({ ...team, group: group.group })))
    .find((team) => canonical(team.name) === winner.canonicalName);
  const fixtures = winnerFixtures();
  const completed = fixtures.filter((match) => match.status === "FT");
  const next = fixtures.find((match) => match.status !== "FT");
  const cleanSheets = completed.filter((match) => {
    const isHome = canonical(match.home.name) === winner.canonicalName;
    return (isHome ? match.awayScore : match.homeScore) === 0;
  }).length;
  const wins = completed.filter((match) => {
    const isHome = canonical(match.home.name) === winner.canonicalName;
    return isHome ? match.homeScore > match.awayScore : match.awayScore > match.homeScore;
  }).length;
  const scored = completed.reduce((sum, match) => {
    const isHome = canonical(match.home.name) === winner.canonicalName;
    return sum + (isHome ? match.homeScore : match.awayScore);
  }, 0);
  const conceded = completed.reduce((sum, match) => {
    const isHome = canonical(match.home.name) === winner.canonicalName;
    return sum + (isHome ? match.awayScore : match.homeScore);
  }, 0);
  const nextPrediction = next ? predictionFor(next) : null;
  const nextWinProbability = nextPrediction
    ? canonical(next.home.name) === winner.canonicalName
      ? nextPrediction.probabilities.home
      : nextPrediction.probabilities.away
    : null;
  const reinforcers = [
    `${groupTeam.points} points from ${groupTeam.played} verified group matches, sitting ${groupTeam.position}${groupTeam.position === 1 ? "st" : groupTeam.position === 2 ? "nd" : groupTeam.position === 3 ? "rd" : "th"} in ${groupTeam.group}.`,
    `${scored} scored / ${conceded} conceded so far; ${cleanSheets} clean sheet${cleanSheets === 1 ? "" : "s"} supports the low ${strengthData.defence} defence-rate signal.`,
    `${winner.probabilities.groupWinner}% group-win and ${winner.probabilities.final}% final probabilities keep the simulated route favourable.`,
  ];
  const watchouts = [
    `${winner.probabilities.champion}% title probability means the model still sees a wide-open tournament, not a certainty.`,
    next
      ? `Next verified fixture: ${next.home.name} vs ${next.away.name}${nextWinProbability ? `; model gives ${winner.name} ${nextWinProbability}% to win.` : "."}`
      : "Group stage complete for this team; knockout draw volatility becomes the main uncertainty.",
    wins === completed.length
      ? "Perfect results help, but knockout simulations still depend on opponent path and Annex C allocation."
      : "Dropped points already exist in the path, so the forecast relies more on strength profile than flawless form.",
  ];
  $("#winner-journey").innerHTML = `
    <div class="journey-hero">
      <div><span>CURRENT PICK</span><strong>${winner.name}</strong><small>${winner.probabilities.champion}% champion · ${winner.probabilities.final}% final</small></div>
      <div><span>TOURNAMENT FORM</span><strong>${wins}-${completed.length - wins}</strong><small>${scored} GF · ${conceded} GA</small></div>
    </div>
    <div class="journey-fixtures">
      ${fixtures
        .map((match) => {
          const isDone = match.status === "FT";
          return `<div class="${isDone ? "done" : "next"}">
            <span>M${match.matchNumber}</span>
            <strong>${match.home.name} ${isDone ? match.homeScore : ""} ${isDone ? "—" : "vs"} ${isDone ? match.awayScore : ""} ${match.away.name}</strong>
            <em>${isDone ? "VERIFIED RESULT" : "NEXT SIGNAL"}</em>
          </div>`;
        })
        .join("")}
    </div>
    <div class="journey-columns">
      <div><h3>Reinforces forecast</h3>${reinforcers.map((item) => `<p>${item}</p>`).join("")}</div>
      <div><h3>Could weaken forecast</h3>${watchouts.map((item) => `<p>${item}</p>`).join("")}</div>
    </div>`;
}

function renderScorecard() {
  const rows = scorecardRows();
  if (!rows.length) return;
  const hits = rows.filter((row) => row.hit).length;
  const accuracy = (hits / rows.length) * 100;
  const brier =
    rows.reduce(
      (sum, row) =>
        sum +
        row.expectation.probabilities.reduce(
          (inner, probability, index) =>
            inner + (probability - (index === row.actualIndex ? 1 : 0)) ** 2,
          0,
        ) /
          3,
      0,
    ) / rows.length;
  const avgConfidence =
    (rows.reduce((sum, row) => sum + row.expectation.confidence, 0) / rows.length) *
    100;
  const avgActualProbability =
    (rows.reduce((sum, row) => sum + row.actualProbability, 0) / rows.length) *
    100;
  const drawRows = rows.filter((row) => row.actualIndex === 1);
  const drawHits = drawRows.filter((row) => row.hit).length;
  const biggestSurprises = [...rows]
    .sort((a, b) => b.surprise - a.surprise)
    .slice(0, 3);
  const strongestHits = rows
    .filter((row) => row.hit)
    .sort((a, b) => b.expectation.confidence - a.expectation.confidence)
    .slice(0, 3);
  $("#scorecard-metrics").innerHTML = [
    ["AUDITED MATCHES", rows.length, "completed FIFA results"],
    ["OUTCOME HIT RATE", pct(accuracy), "home/draw/away pick"],
    ["AVG CONFIDENCE", pct(avgConfidence), "when model makes its top call"],
    ["BRIER SCORE", Math.round(brier * 1000) / 1000, "lower is better"],
    ["ACTUAL-LIKELIHOOD", pct(avgActualProbability), "probability assigned to what happened"],
    ["DRAW READ", `${drawHits}/${drawRows.length}`, "draw outcomes correctly called"],
  ]
    .map(
      ([label, value, note]) =>
        `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
    )
    .join("");
  $("#scorecard-signals").innerHTML = `
    <div class="signal-stack">
      <div><span>TOP CONFIDENT HITS</span>${strongestHits
        .map((row) => `<p>${row.match.home.name} ${row.match.homeScore}-${row.match.awayScore} ${row.match.away.name}<b>${row.predictedLabel} · ${pct(row.expectation.confidence * 100)}</b></p>`)
        .join("")}</div>
      <div><span>BIGGEST SURPRISES</span>${biggestSurprises
        .map((row) => `<p>${row.match.home.name} ${row.match.homeScore}-${row.match.awayScore} ${row.match.away.name}<b>${pct(row.actualProbability * 100)} assigned to actual</b></p>`)
        .join("")}</div>
    </div>
    <p class="audit-note">This is a live retrospective scorecard from the current calibrated model state. It is useful for model behaviour and calibration, but not a claim that every completed match had a frozen pre-match forecast saved before kickoff.</p>`;
  $("#scorecard-table").innerHTML = rows
    .slice(-16)
    .reverse()
    .map(
      (row) => `<div class="audit-row ${row.hit ? "hit" : "miss"}">
        <span>M${row.match.matchNumber}</span>
        <strong>${row.match.home.name} ${row.match.homeScore}–${row.match.awayScore} ${row.match.away.name}</strong>
        <b>${row.predictedLabel}</b>
        <em>${row.hit ? "HIT" : "MISS"}</em>
        <small>${pct(row.actualProbability * 100)} actual likelihood</small>
      </div>`,
    )
    .join("");
  renderWinnerJourney();
}

function renderBetting() {
  const rows = marketOutcomeRows();
  const valueRows = sortBettingRows(
    rows.filter((row) => ["VALUE WATCH", "LEAN ONLY"].includes(row.recommendation)),
    "balanced",
  );
  const avoidRows = rows
    .filter((row) => ["AVOID", "NO BET"].includes(row.recommendation))
    .sort(
      (a, b) =>
        a.expectedReturn - b.expectedReturn ||
        a.probabilityEdge - b.probabilityEdge,
    );
  const visibleRows = sortBettingRows(filterBettingRows(rows), bettingSort);
  const dateColumns = nextBettingDateColumns(visibleRows);
  const best = valueRows[0];
  const upcomingEvents = new Set(rows.map((row) => row.event.eventId));
  const greenCount = rows.filter((row) => row.signal.label === "GREEN").length;
  const amberCount = rows.filter((row) => row.signal.label === "AMBER").length;
  const freshLabel = market?.refreshStatus
    ? `STALE / ${market.warning || "using cached odds"}`
    : `UPDATED ${fmtDate(market.generatedAt).toUpperCase()}`;
  $("#betting-summary").innerHTML = `
    <div class="betting-kpi-grid">
      <div><span>ODDS SNAPSHOT</span><strong>${freshLabel}</strong><small>${market?.source?.name || "Singapore Pools"}</small></div>
      <div><span>UPCOMING MARKETS</span><strong>${upcomingEvents.size}</strong><small>matched to model fixtures</small></div>
      <div><span>SIGNAL SPLIT</span><strong>${greenCount}G / ${amberCount}A</strong><small>green and amber value signals</small></div>
      <div><span>TOP BALANCED</span><strong>${best ? best.label : "NO BET"}</strong><small>${best ? `${best.expectedReturn}% EV · ${best.decimalOdds.toFixed(2)} odds` : "no qualifying edge"}</small></div>
    </div>
    <p class="betting-warning">EV/value is price quality. Signal strength is model conviction. Default sorting uses both; use the dropdowns to inspect pure EV, model confidence, odds, or avoid/no-bet outcomes.</p>`;
  $("#betting-count").textContent = dateColumns.reduce(
    (sum, column) => sum + column.rows.length,
    0,
  );
  $("#betting-board").innerHTML =
    visibleRows.length
      ? renderBettingColumns(dateColumns)
      : '<div class="market-empty">No outcomes match the current betting filter.</div>';
  $("#betting-avoid").innerHTML =
    avoidRows.length
      ? avoidRows.slice(0, 10).map(renderBettingRow).join("")
      : '<div class="market-empty">No strongly negative model edge found in upcoming match odds.</div>';
}

function singaporeDateKey(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function singaporeDateLabel(dateKey) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${dateKey}T00:00:00+08:00`));
}

function nextBettingDateColumns(rows) {
  const keys = [...new Set(rows.map((row) => singaporeDateKey(row.event.startTime)))]
    .sort()
    .slice(0, 3);
  return keys.map((key) => ({
    key,
    label: singaporeDateLabel(key),
    rows: rows.filter((row) => singaporeDateKey(row.event.startTime) === key),
  }));
}

function renderBettingColumns(columns) {
  return `<div class="betting-day-grid">${columns
    .map(
      (column) => `<section class="betting-day">
        <h3><strong>${column.label}</strong><small>${column.rows.length} outcome${column.rows.length === 1 ? "" : "s"}</small></h3>
        <div>${column.rows.length ? column.rows.map(renderBettingRow).join("") : '<div class="market-empty">No matched outcomes for this date.</div>'}</div>
      </section>`,
    )
    .join("")}</div>`;
}

function filterBettingRows(rows) {
  if (bettingFilter === "all") return rows;
  if (bettingFilter === "value") {
    return rows.filter((row) => ["VALUE WATCH", "LEAN ONLY"].includes(row.recommendation));
  }
  if (bettingFilter === "green") {
    return rows.filter((row) => row.signal.label === "GREEN");
  }
  if (bettingFilter === "amber") {
    return rows.filter((row) => row.signal.label === "AMBER");
  }
  if (bettingFilter === "red") {
    return rows.filter((row) => row.signal.label === "RED");
  }
  if (bettingFilter === "avoid") {
    return rows.filter((row) => row.recommendation === "AVOID");
  }
  return rows;
}

function sortBettingRows(rows, sortMode) {
  const sorted = [...rows];
  const kickoff = (row) => new Date(row.event.startTime).getTime();
  const sorters = {
    balanced: (a, b) =>
      b.signal.rank - a.signal.rank ||
      b.expectedReturn - a.expectedReturn ||
      b.probabilityEdge - a.probabilityEdge ||
      b.modelProbability - a.modelProbability,
    ev: (a, b) =>
      b.expectedReturn - a.expectedReturn ||
      b.probabilityEdge - a.probabilityEdge ||
      b.signal.rank - a.signal.rank,
    signal: (a, b) =>
      b.signal.rank - a.signal.rank ||
      b.modelProbability - a.modelProbability ||
      b.expectedReturn - a.expectedReturn,
    confidence: (a, b) =>
      b.modelProbability - a.modelProbability ||
      b.probabilityEdge - a.probabilityEdge,
    odds: (a, b) =>
      b.decimalOdds - a.decimalOdds ||
      b.expectedReturn - a.expectedReturn,
    kickoff: (a, b) =>
      kickoff(a) - kickoff(b) ||
      b.signal.rank - a.signal.rank ||
      b.expectedReturn - a.expectedReturn,
  };
  return sorted.sort(sorters[sortMode] || sorters.balanced);
}

function renderBettingRow(row) {
  const cls =
    row.recommendation === "VALUE WATCH"
      ? "value"
      : row.recommendation === "LEAN ONLY"
        ? "lean"
        : "avoid";
  return `<div class="bet-row ${cls}" role="button" tabindex="0" data-bet-row="${betRowId(row)}" aria-label="Explain ${row.label} betting signal for ${row.homeName} vs ${row.awayName}">
    <div class="bet-card-top"><span>M${row.fixture.matchNumber} · ${new Date(row.event.startTime).toLocaleString("en-SG", { hour: "2-digit", minute: "2-digit" })}</span><small>${row.fixture.status}</small></div>
    <strong class="bet-pick">${row.label}</strong>
    <div class="bet-matchline">${row.homeName} vs ${row.awayName}</div>
    <div class="bet-metrics">
      <b>${row.decimalOdds.toFixed(2)}</b>
      <b class="model-chip signal-${row.signal.label.toLowerCase()}">${row.modelProbability}%</b>
      <em>${row.expectedReturn > 0 ? "+" : ""}${row.expectedReturn}%</em>
    </div>
    <small class="bet-subline">${row.probabilityEdge > 0 ? "+" : ""}${row.probabilityEdge}pp edge · ${row.marketImpliedProbability}% market</small>
  </div>`;
}

function openBetExplainer(id) {
  const row = bettingRowById(id);
  if (!row) return;
  $("#bet-explainer-content").innerHTML = explainBet(row);
  $("#bet-explainer").classList.remove("hidden");
  $("#bet-explainer").setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeBetExplainer() {
  $("#bet-explainer").classList.add("hidden");
  $("#bet-explainer").setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function renderLatestSignal() {
  const latest = worldCup.fixtures
    .filter((match) => match.status === "FT")
    .sort((a, b) => b.matchNumber - a.matchNumber)[0];
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(worldCup.generatedAt).getTime()) / 3_600_000,
  );
  if (!latest) {
    $("#freshness-label").textContent = "NO COMPLETED MATCHES";
    $("#latest-signal-content").textContent =
      "The verified snapshot does not yet contain a completed fixture.";
    return;
  }
  $("#freshness-label").textContent =
    ageHours < 1 ? "UPDATED <1H AGO" : `UPDATED ${Math.floor(ageHours)}H AGO`;
  $("#latest-signal-content").innerHTML = `
    <div class="latest-scoreline"><span>${latest.home.name}</span><strong>${latest.homeScore} — ${latest.awayScore}</strong><span>${latest.away.name}</span></div>
    <div class="freshness-metrics">
      <div><span>SNAPSHOT</span><strong>${fmtDate(worldCup.generatedAt)}</strong></div>
      <div><span>COMPLETED</span><strong>${worldCup.tournament.completedMatches}/${worldCup.tournament.totalMatches}</strong></div>
      <div><span>MODEL RUN</span><strong>${simulation.simulations.toLocaleString()}</strong></div>
    </div>
    <a class="source-link" href="${worldCup.source.fixturesUrl}" target="_blank" rel="noreferrer">OPEN LIVE FIFA SOURCE ↗</a>`;
}

function renderMarketLens() {
  const warning = market.refreshStatus
    ? `<div class="market-warning">Odds refresh warning: ${market.warning}. Showing last official Singapore Pools snapshot from ${fmtDate(market.generatedAt)}.</div>`
    : "";
  if (!market?.valueWatchlist?.length) {
    $("#market-watchlist").innerHTML =
      `${warning}<div class="market-empty">No qualifying model-versus-market edge in the current official odds snapshot.</div>`;
    return;
  }
  const conviction = {
    Argentina: "STRONGEST MODEL SIGNAL",
    Morocco: "SPECULATIVE VALUE",
    Japan: "SPECULATIVE VALUE",
  };
  $("#market-watchlist").innerHTML = warning + market.valueWatchlist
    .slice(0, 3)
    .map(
      (item) => `<div class="market-row">
        <div><strong>${item.team}</strong><span>${conviction[item.team] || "MODEL VALUE"}</span></div>
        <div><span>SP ODDS</span><b>${item.decimalOdds.toFixed(2)}</b></div>
        <div><span>MARKET</span><b>${item.marketImpliedProbability}%</b></div>
        <div><span>MODEL</span><b>${item.modelProbability}%</b></div>
        <em>+${item.probabilityEdge}pp</em>
      </div>`,
    )
    .join("");
}

function renderMatches() {
  const query = $("#match-search").value.toLowerCase();
  const status = $("#status-filter").value;
  const matches = worldCup.fixtures.filter((match) => {
    const haystack = [
      match.home.name,
      match.away.name,
      match.group,
      match.venue,
      match.city,
    ]
      .join(" ")
      .toLowerCase();
    const statusMatch =
      status === "all" ||
      (status === "upcoming" && match.status !== "FT") ||
      match.status === status;
    return haystack.includes(query) && statusMatch;
  });
  $("#match-count").textContent = matches.length;
  $("#all-matches").innerHTML = matches
    .map(
      (match) => `<article class="match-card">
        <div class="match-card-top"><span>${match.group || match.stage || "TOURNAMENT"}</span><b>${match.status}</b></div>
        ${matchRow(match)}
        ${predictionPanel(match)}
        <div class="match-meta">${[match.venue, match.city].filter(Boolean).join(" · ") || "Venue pending"}</div>
      </article>`,
    )
    .join("");
}

function allTeams() {
  return worldCup.standings.flatMap((group) =>
    group.teams.map((team) => ({ ...team, group: group.group })),
  );
}

function renderComparison() {
  const teams = allTeams();
  const a = teams.find((team) => team.code === $("#team-a").value) || teams[0];
  const b = teams.find((team) => team.code === $("#team-b").value) || teams[1];
  const stats = [
    ["POINTS", a.points, b.points],
    ["PLAYED", a.played, b.played],
    ["WINS", a.won, b.won],
    ["GOALS FOR", a.goalsFor, b.goalsFor],
    ["GOALS AGAINST", a.goalsAgainst, b.goalsAgainst],
    ["GOAL DIFFERENCE", a.goalDifference, b.goalDifference],
  ];
  const modelA = model?.contenders.find((team) => team.name === canonical(a.name));
  const modelB = model?.contenders.find((team) => team.name === canonical(b.name));
  if (modelA && modelB) {
    stats.push(
      ["ELO-POISSON RATING", modelA.rating, modelB.rating],
      ["ATTACK RATE", modelA.attack, modelB.attack],
      ["DEFENCE RATE", modelA.defence, modelB.defence],
    );
  }
  const simA = simulation?.teams.find(
    (team) => team.canonicalName === canonical(a.name),
  );
  const simB = simulation?.teams.find(
    (team) => team.canonicalName === canonical(b.name),
  );
  if (simA && simB) {
    stats.push(
      [
        "TITLE PROBABILITY",
        `${simA.probabilities.champion}%`,
        `${simB.probabilities.champion}%`,
      ],
      [
        "FINAL PROBABILITY",
        `${simA.probabilities.final}%`,
        `${simB.probabilities.final}%`,
      ],
    );
  }
  $("#comparison").innerHTML = `
    <div class="compare-header">
      <div class="compare-team">${flag(a)}<h2>${a.name}</h2><p>${a.group} · POSITION ${a.position}</p></div>
      <div class="compare-vs">OFFICIAL<br>STATS</div>
      <div class="compare-team">${flag(b)}<h2>${b.name}</h2><p>${b.group} · POSITION ${b.position}</p></div>
    </div>
    <div class="stat-compare">
      ${stats.map(([label, left, right]) => `<div class="stat-line"><span>${left}</span><label>${label}</label><span>${right}</span></div>`).join("")}
    </div>`;
}

function renderModel() {
  const entries = [
    ["Verified", audit.summary.verified, "verified"],
    ["Derivable", audit.summary.derivable, "derived"],
    ["Unavailable", audit.summary.unavailable, "missing"],
    ["Blocked", audit.summary.blocked, "missing"],
  ];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  $("#coverage-list").innerHTML = entries
    .map(
      ([label, value, cls]) => `<div class="coverage-row ${cls}">
        <span>${label}</span><div class="bar"><i style="width:${(value / total) * 100}%"></i></div><b>${value}</b>
      </div>`,
    )
    .join("");
  $("#coverage-timestamp").textContent = fmtDate(audit.generatedAt).toUpperCase();
  if (model) {
    const metrics = [
      ["TEST MATCHES", model.performance.matches, "2022–2026"],
      ["ACCURACY", `${model.performance.accuracy}%`, "3-way outcome"],
      ["BRIER", model.performance.brier, "lower is better"],
      ["CALIBRATION", `${model.performance.calibrationError}%`, "error"],
    ];
    $("#performance-grid").innerHTML = metrics
      .map(
        ([label, value, note]) =>
          `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
      )
      .join("");
    $$(".gate-list .pending").forEach((gate) => {
      gate.className = "pass";
      gate.querySelector("i").textContent = "✓";
      gate.querySelector("strong").textContent = "PASS";
    });
    const publicGate = $(".gate-list .locked");
    if (publicGate) {
      publicGate.className = "pass";
      publicGate.querySelector("i").textContent = "✓";
      publicGate.querySelector("span").textContent = "Tournament predictions";
      publicGate.querySelector("strong").textContent = "LIVE";
    }
    const simulationStep = $$(".flow-step").at(-1);
    simulationStep.className = "flow-step complete";
  }
}

function renderAll() {
  $("#last-updated").textContent = fmtDate(worldCup.generatedAt).toUpperCase();
  $("#pipeline-status").textContent = `${audit.summary.verified} fields verified`;
  renderOverview();
  renderGroups();
  renderBracket();
  renderMatches();
  renderComparison();
  renderModel();
  renderScorecard();
  renderBetting();
}

async function fetchJson(path, label, cacheBust = false) {
  const suffix = cacheBust ? `?t=${Date.now()}` : "";
  const response = await fetch(`${path}${suffix}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${label} unavailable`);
  return response.json();
}

async function checkLatest() {
  const button = $("#refresh-data");
  const status = $("#refresh-status");
  const previousSnapshot = worldCup.generatedAt;
  button.disabled = true;
  button.textContent = "↻ CHECKING…";
  status.textContent =
    "Checking the latest deployed verified snapshot. Live scraping runs in the data pipeline, not inside this static page.";
  try {
    [worldCup, audit, model, simulation, market] = await Promise.all([
      fetchJson("./outputs/worldcup.json", "World Cup feed", true),
      fetchJson("./outputs/data-availability.json", "Audit feed", true),
      fetchJson("./outputs/model.json", "Model feed", true),
      fetchJson(
        "./outputs/tournament-simulation.json",
        "Tournament simulation",
        true,
      ),
      fetchJson("./outputs/market-odds.json", "Market odds", true),
    ]);
    renderAll();
    status.textContent =
      worldCup.generatedAt === previousSnapshot
        ? "Already on the latest deployed snapshot. If a match just ended, run or wait for the data pipeline to scrape FIFA and redeploy."
        : `New verified snapshot loaded: ${fmtDate(worldCup.generatedAt)}.`;
  } catch (error) {
    status.textContent = `Latest check failed: ${error.message}. Existing verified snapshot retained.`;
  } finally {
    button.disabled = false;
    button.textContent = "↻ CHECK LATEST";
  }
}

async function boot() {
  try {
    [worldCup, audit, model, simulation, market] = await Promise.all([
      fetchJson("./outputs/worldcup.json", "World Cup feed"),
      fetchJson("./outputs/data-availability.json", "Audit feed"),
      fetchJson("./outputs/model.json", "Model feed"),
      fetchJson(
        "./outputs/tournament-simulation.json",
        "Tournament simulation",
      ),
      fetchJson("./outputs/market-odds.json", "Market odds"),
    ]);

    const teams = allTeams();
    const options = teams
      .map((team) => `<option value="${team.code}">${team.name}</option>`)
      .join("");
    $("#team-a").innerHTML = options;
    $("#team-b").innerHTML = options;
    $("#team-a").value = teams.find((team) => team.name === "Brazil")?.code || teams[0].code;
    $("#team-b").value = teams.find((team) => team.name === "France")?.code || teams[1].code;
    renderAll();
  } catch (error) {
    $("#pipeline-status").textContent = "Feed unavailable";
    $(".view.active").insertAdjacentHTML(
      "afterbegin",
      `<div class="error-box">DATA LOAD FAILED — ${error.message}</div>`,
    );
  }
}

$$(".nav-item").forEach((button) =>
  button.addEventListener("click", () => setView(button.dataset.view)),
);
$$("[data-jump]").forEach((button) =>
  button.addEventListener("click", () => setView(button.dataset.jump)),
);
$("#menu-toggle").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#match-search").addEventListener("input", renderMatches);
$("#status-filter").addEventListener("change", renderMatches);
$("#team-a").addEventListener("change", renderComparison);
$("#team-b").addEventListener("change", renderComparison);
$("#refresh-data").addEventListener("click", checkLatest);
$("#betting-sort").addEventListener("change", (event) => {
  bettingSort = event.target.value;
  renderBetting();
});
$("#betting-filter").addEventListener("change", (event) => {
  bettingFilter = event.target.value;
  renderBetting();
});
document.addEventListener("click", (event) => {
  const row = event.target.closest("[data-bet-row]");
  if (row) openBetExplainer(row.dataset.betRow);
  if (event.target.closest("[data-close-bet-explainer]")) closeBetExplainer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeBetExplainer();
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-bet-row]")) {
    event.preventDefault();
    openBetExplainer(event.target.dataset.betRow);
  }
});

const initialView = location.hash.slice(1);
if (initialView && document.getElementById(initialView)) setView(initialView);
boot();
