import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = process.cwd();
const simulation = JSON.parse(
  await fs.readFile(path.join(root, "outputs/tournament-simulation.json"), "utf8"),
);
const url =
  "https://online.singaporepools.com/en/sports/competition/171/football/world/w-cup";
const aliases = {
  Holland: "Netherlands",
  "Ivory Coast": "Côte d'Ivoire",
  Bosnia: "Bosnia and Herzegovina",
  "Czech Republic": "Czechia",
};

const browser = await chromium.launch({ headless: true });
let outrights = null;
let upcoming = null;
try {
  const page = await browser.newPage({ locale: "en-SG" });
  page.on("response", async (response) => {
    if (response.status() !== 200) return;
    const responseUrl = response.url();
    try {
      if (responseUrl.includes("event/outright-special")) {
        outrights = await response.json();
      }
      if (responseUrl.includes("event/upcoming/football")) {
        upcoming = await response.json();
      }
    } catch {}
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(12_000);
} finally {
  await browser.close();
}

if (!outrights || !upcoming) {
  throw new Error("Singapore Pools public odds responses were not captured");
}

const winnerEvent = outrights.events.find((event) =>
  event.markets?.some((market) => market.name === "Championship Winner"),
);
const winnerMarket = winnerEvent?.markets.find(
  (market) => market.name === "Championship Winner",
);
if (!winnerMarket) throw new Error("Championship Winner market unavailable");

const teamProbability = new Map(
  simulation.teams.map((team) => [team.name, team.probabilities.champion]),
);
const championship = winnerMarket.outcomes
  .filter((outcome) => outcome.isActive && outcome.prices?.[0]?.decimal)
  .map((outcome) => {
    const team = aliases[outcome.name] || outcome.name;
    const decimalOdds = Number(outcome.prices[0].decimal);
    const modelProbability = teamProbability.get(team) ?? null;
    const marketImpliedProbability =
      Math.round((100 / decimalOdds) * 10) / 10;
    const expectedReturn =
      modelProbability === null
        ? null
        : Math.round(
            ((modelProbability / 100) * decimalOdds - 1) * 1000,
          ) / 10;
    return {
      team,
      decimalOdds,
      marketImpliedProbability,
      modelProbability,
      probabilityEdge:
        modelProbability === null
          ? null
          : Math.round((modelProbability - marketImpliedProbability) * 10) / 10,
      expectedReturn,
    };
  });

const valueWatchlist = championship
  .filter(
    (item) =>
      item.modelProbability >= 5 &&
      item.probabilityEdge >= 2 &&
      item.expectedReturn > 10,
  )
  .sort(
    (a, b) =>
      b.modelProbability - a.modelProbability ||
      b.expectedReturn - a.expectedReturn,
  );

const matches = upcoming.events
  .map((event) => {
    const market = event.markets?.find(
      (candidate) =>
        candidate.name === "1X2" ||
        candidate.minorCode === "MR",
    );
    if (!market || market.outcomes?.length < 3) return null;
    const prices = Object.fromEntries(
      market.outcomes.map((outcome) => [
        outcome.name,
        Number(outcome.prices?.[0]?.decimal),
      ]),
    );
    return {
      eventId: event.id,
      eventNumber: event.retailId || null,
      name: event.name,
      startTime: event.startTime,
      home: event.participants?.find((item) => item.position === "HOME")?.name,
      away: event.participants?.find((item) => item.position === "AWAY")?.name,
      prices,
    };
  })
  .filter(Boolean);

const output = {
  generatedAt: new Date().toISOString(),
  source: {
    name: "Singapore Pools",
    url,
    market: "World Cup",
  },
  responsiblePlay: {
    notice:
      "Odds are shown for market comparison, not as a guarantee or instruction to bet.",
    helpline: "1800-6-668-668",
    url: "https://www.ncpg.org.sg/",
  },
  championship,
  valueWatchlist,
  matches,
};

await fs.writeFile(
  path.join(root, "outputs/market-odds.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    championshipSelections: championship.length,
    matches: matches.length,
    valueWatchlist: valueWatchlist.slice(0, 5),
  }),
);
