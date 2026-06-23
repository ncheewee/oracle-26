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
  $("#projected-bracket").innerHTML = Object.values(
    simulation.projectedMatches,
  )
    .filter((match) => /^M(7[3-9]|8[0-8])$/.test(match.matchId))
    .sort(
      (a, b) =>
        Number(a.matchId.slice(1)) - Number(b.matchId.slice(1)),
    )
    .map(
      (match) => `<div class="bracket-match">
        <div class="bracket-id"><span>${match.matchId}</span><b>${match.probability}% path frequency</b></div>
        <div>${flag({ flag: flagMap.get(match.home) })}<strong>${match.home}</strong></div>
        <div>${flag({ flag: flagMap.get(match.away) })}<strong>${match.away}</strong></div>
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
    publicGate.className = "pass";
    publicGate.querySelector("i").textContent = "✓";
    publicGate.querySelector("span").textContent = "Tournament predictions";
    publicGate.querySelector("strong").textContent = "LIVE";
    const simulationStep = $$(".flow-step").at(-1);
    simulationStep.className = "flow-step complete";
  }
}

async function boot() {
  try {
    [worldCup, audit, model, simulation] = await Promise.all([
      fetch("./outputs/worldcup.json").then((response) => {
        if (!response.ok) throw new Error("World Cup feed unavailable");
        return response.json();
      }),
      fetch("./outputs/data-availability.json").then((response) => {
        if (!response.ok) throw new Error("Audit feed unavailable");
        return response.json();
      }),
      fetch("./outputs/model.json").then((response) => {
        if (!response.ok) throw new Error("Model feed unavailable");
        return response.json();
      }),
      fetch("./outputs/tournament-simulation.json").then((response) => {
        if (!response.ok) throw new Error("Tournament simulation unavailable");
        return response.json();
      }),
    ]);
    $("#last-updated").textContent = fmtDate(worldCup.generatedAt).toUpperCase();
    $("#pipeline-status").textContent = `${audit.summary.verified} fields verified`;

    renderOverview();
    renderGroups();
    renderBracket();
    renderMatches();

    const teams = allTeams();
    const options = teams
      .map((team) => `<option value="${team.code}">${team.name}</option>`)
      .join("");
    $("#team-a").innerHTML = options;
    $("#team-b").innerHTML = options;
    $("#team-a").value = teams.find((team) => team.name === "Brazil")?.code || teams[0].code;
    $("#team-b").value = teams.find((team) => team.name === "France")?.code || teams[1].code;
    renderComparison();
    renderModel();
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

const initialView = location.hash.slice(1);
if (initialView && document.getElementById(initialView)) setView(initialView);
boot();
