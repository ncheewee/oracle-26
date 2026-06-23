import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const targets = JSON.parse(
  await fs.readFile(path.join(root, "config/audit-targets.json"), "utf8"),
);
const contract = JSON.parse(
  await fs.readFile(path.join(root, "config/data-contract.json"), "utf8"),
);

const observedAt = new Date().toISOString();
const evidence = [];

function record(field, status, source, detail, url = null) {
  evidence.push({
    field,
    status,
    source,
    detail: String(detail).replace(/\s+/g, " ").trim(),
    url,
    observedAt,
  });
}

async function fetchProbe(name, url, options = {}) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      ...options,
    });
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  } catch (error) {
    return { name, url, ok: false, status: null, error: error.message, body: "" };
  }
}

function has(text, label) {
  return text.toLowerCase().includes(label.toLowerCase());
}

async function renderedText(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(6_000);
  return page.locator("body").innerText();
}

async function dismissCookies(page) {
  const reject = page.getByRole("button", { name: "Reject All" });
  if (await reject.count()) await reject.click().catch(() => {});
}

async function auditFifa(browser) {
  const page = await browser.newPage({
    locale: "en-US",
    timezoneId: "Asia/Singapore",
  });

  const fixtureText = await renderedText(page, targets.fixturesUrl);
  await dismissCookies(page);
  await page
    .locator('a[href*="/match-centre/match/"]')
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => {});
  const links = await page
    .locator('a[href*="/match-centre/match/"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.href,
        text: (node.textContent || "").replace(/\s+/g, " ").trim(),
      })),
    );

  for (const [field, label] of Object.entries({
    fixtures: "Match Fixtures",
    results: "FT",
    kickoff: "Match Time",
    stage: "First Stage",
    group: "Group",
    venue: "Stadium",
  })) {
    record(
      field,
      has(fixtureText, label) ? "verified" : "unavailable",
      "FIFA rendered fixtures",
      has(fixtureText, label) ? `Observed label: ${label}` : `Missing label: ${label}`,
      targets.fixturesUrl,
    );
  }

  const standingsText = await renderedText(page, targets.standingsUrl);
  record(
    "standings",
    /played|pts|points/i.test(standingsText) ? "verified" : "unavailable",
    "FIFA rendered standings",
    "Checked standings table labels",
    targets.standingsUrl,
  );

  const rankingText = await renderedText(page, targets.rankingUrl);
  record(
    "official_ranking",
    has(rankingText, "Latest Men’s World Ranking") ? "verified" : "unavailable",
    "FIFA ranking",
    (
      rankingText.match(/Last official update:\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/i) || [
        "Update date not found",
      ]
    )[0],
    targets.rankingUrl,
  );

  const completed = links.filter((link) => /FT/.test(link.text));
  const upcoming = links.filter((link) => !/FT/.test(link.text));
  const discoveredSamples = [
    ...completed.slice(0, targets.sampleCompletedMatches),
    ...upcoming.slice(0, targets.sampleUpcomingMatches),
  ];
  const knownSamples = (targets.knownCompletedMatches || []).map((href) => ({
    href,
    text: "Known completed match",
    completed: true,
  }));
  const samples = [...knownSamples, ...discoveredSamples]
    .filter(
      (sample, index, all) =>
        all.findIndex((candidate) => candidate.href === sample.href) === index,
    )
    .slice(0, targets.sampleCompletedMatches + targets.sampleUpcomingMatches);

  const matchLabels = {
    lineups: "LINE UP",
    events: "Full Time",
    possession: "Possession",
    goals: "Goal",
    attempts: "Attempts at Goal",
    shots_on_target: "On Target",
    final_third_entries: "Final Third Entries",
    offers_to_receive: "Offers to Receive",
    line_breaks: "Line Breaks",
    cards: "Yellow Cards",
    fouls: "Fouls Against",
    offsides: "Offsides",
    passes: "Passes Completed",
    crosses: "Crosses Completed",
    corners: "Corners",
    free_kicks: "Free Kicks",
    forced_turnovers: "Forced Turnovers",
    pressing: "Pressing Applied",
    player_distance: "Total Distance",
    player_speed: "Average Speed",
    player_sprints: "Sprints",
    recent_form: "Form",
    head_to_head: "Head to Head",
  };

  const hits = Object.fromEntries(Object.keys(matchLabels).map((key) => [key, 0]));
  const sampleEvidence = [];

  for (const sample of samples) {
    const text = await renderedText(page, sample.href);
    await dismissCookies(page);
    const statsTab = page.getByText("STATS", { exact: true });
    if (await statsTab.count()) {
      await statsTab.first().click().catch(() => {});
      await page.waitForTimeout(600);
    }
    const statsText = await page.locator("body").innerText();
    for (const [field, label] of Object.entries(matchLabels)) {
      if (has(`${text}\n${statsText}`, label)) hits[field] += 1;
    }
    sampleEvidence.push({
      url: sample.href,
      fixture: sample.text,
      completed: sample.completed ?? /FT/.test(sample.text),
    });
  }

  for (const [field, count] of Object.entries(hits)) {
    record(
      field,
      count > 0 ? "verified" : "unavailable",
      "FIFA rendered match centre",
      `Observed in ${count}/${samples.length} sampled matches`,
      samples[0]?.href ?? targets.fixturesUrl,
    );
  }

  const teamLinks = await page
    .locator('a[href*="/teams/"]')
    .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.href))]);
  record(
    "squad",
    teamLinks.length > 0 ? "verified" : "unavailable",
    "FIFA team pages",
    `${teamLinks.length} team links observed on sampled match page`,
    teamLinks[0] ?? targets.tournamentUrl,
  );

  const termsText = await renderedText(page, targets.termsUrl);
  const reuseRestricted =
    has(termsText, "Content may not be used, reproduced") &&
    has(termsText, "non-commercial purposes");
  record(
    "fifa_reuse_permission",
    reuseRestricted ? "blocked" : "unavailable",
    "FIFA Terms of Service",
    reuseRestricted
      ? "Terms restrict content reuse; legal review or written permission remains advisable"
      : "Relevant reuse clause was not detected",
    targets.termsUrl,
  );

  await page.close();
  return { fixtureLinks: links.length, samples: sampleEvidence };
}

async function auditSupplemental() {
  const [statsbomb, weather, footballData] = await Promise.all([
    fetchProbe("StatsBomb Open Data", targets.supplemental.statsbomb),
    fetchProbe("Open-Meteo", targets.supplemental.openMeteo),
    fetchProbe("football-data.org", targets.supplemental.footballData),
  ]);

  let statsbombWorldCups = 0;
  if (statsbomb.ok) {
    try {
      const competitions = JSON.parse(statsbomb.body);
      statsbombWorldCups = competitions.filter((item) =>
        /world cup/i.test(item.competition_name),
      ).length;
    } catch {}
  }
  record(
    "historical_event_training_data",
    statsbombWorldCups > 0 ? "verified" : "unavailable",
    "StatsBomb Open Data",
    `${statsbombWorldCups} World Cup competition-season records found`,
    targets.supplemental.statsbomb,
  );

  record(
    "weather",
    weather.ok && has(weather.body, "temperature_2m") ? "verified" : "unavailable",
    "Open-Meteo",
    `HTTP ${weather.status ?? "error"}; venue coordinates must be mapped`,
    targets.supplemental.openMeteo,
  );

  record(
    "backup_fixtures",
    footballData.ok ? "verified" : footballData.status === 403 ? "blocked" : "unavailable",
    "football-data.org",
    footballData.ok
      ? "World Cup competition endpoint responded"
      : `HTTP ${footballData.status ?? "error"}; API token may be required`,
    targets.supplemental.footballData,
  );

  for (const field of ["injuries", "player_availability", "expected_goals"]) {
    record(
      field,
      "unavailable",
      "Current audited sources",
      "Not consistently structured across all teams and matches",
    );
  }
  record(
    "market_consensus",
    "blocked",
    "Licensed odds provider required",
    "Excluded from initial public build",
  );
}

function addDerivedFields() {
  for (const field of contract.derived) {
    record(
      field,
      "derivable",
      "ORACLE 26 model",
      "Computed only from validated inputs and labelled as a model estimate",
    );
  }
}

function markdown(report) {
  const rows = report.evidence
    .map(
      (item) =>
        `| ${item.field} | ${item.status} | ${item.source} | ${item.detail.replaceAll("|", "\\|")} |`,
    )
    .join("\n");
  return `# ORACLE 26 data availability

Generated: ${report.generatedAt}

This report records observed evidence, not assumptions. Missing fields must
render as **Unavailable** in the product.

## Summary

- Verified: ${report.summary.verified}
- Derivable: ${report.summary.derivable}
- Unavailable: ${report.summary.unavailable}
- Blocked: ${report.summary.blocked}
- FIFA fixture links observed: ${report.fifa.fixtureLinks}
- Match pages sampled: ${report.fifa.samples.length}

## Field coverage

| Field | Status | Source | Evidence |
|---|---|---|---|
${rows}

## Decision

The dashboard may display only fields marked **verified** or **derivable**.
Browser extraction is an operational fallback, not evidence of a redistribution
licence. FIFA attribution, links, conservative request rates, and a legal review
remain required before public launch.
`;
}

await fs.mkdir(path.join(root, "outputs"), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const fifa = await auditFifa(browser);
  await auditSupplemental();
  addDerivedFields();

  const summary = evidence.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { verified: 0, derivable: 0, unavailable: 0, blocked: 0 },
  );
  const report = { generatedAt: observedAt, summary, fifa, evidence };
  await fs.writeFile(
    path.join(root, "outputs/data-availability.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(root, "outputs/data-availability.md"),
    markdown(report),
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
