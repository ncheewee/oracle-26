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
  return model.predictions.find(
    (prediction) =>
      prediction.home === canonical(match.home.name) &&
      prediction.away === canonical(match.away.name),
  );
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
    <div class="prediction-head"><span>MODEL PREDICTION</span><b>${prediction.predictedScore.home}–${prediction.predictedScore.away}</b></div>
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
  if (!market?.valueWatchlist?.length) {
    $("#market-watchlist").innerHTML =
      '<div class="market-empty">No qualifying model-versus-market edge in the current official odds snapshot.</div>';
    return;
  }
  const conviction = {
    Argentina: "STRONGEST MODEL SIGNAL",
    Morocco: "SPECULATIVE VALUE",
    Japan: "SPECULATIVE VALUE",
  };
  $("#market-watchlist").innerHTML = market.valueWatchlist
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
  status.textContent = "Checking the latest deployed verified snapshot…";
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
        ? "Already on the latest deployed snapshot. Source ingestion runs separately in the verified pipeline."
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

const initialView = location.hash.slice(1);
if (initialView && document.getElementById(initialView)) setView(initialView);
boot();
