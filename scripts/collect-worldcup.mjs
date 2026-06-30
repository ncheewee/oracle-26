import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { isValidStandings } from "../lib/worldcup-data.mjs";

const root = process.cwd();
const outputPath = path.join(root, "outputs/worldcup.json");
const base =
  "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026";

async function waitForContent(page, selector, timeout = 25_000) {
  await page.locator(selector).first().waitFor({
    state: "attached",
    timeout,
  });
}

async function readCachedReport() {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}

function conciseError(error) {
  return String(error?.message || error)
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function collectFixtures(page) {
  const url = `${base}/scores-fixtures`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForContent(page, 'a[href*="/match-centre/match/"]');

  return page.locator('a[href*="/match-centre/match/"]').evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const dateText =
        node
          .closest(".col-xl-12")
          ?.textContent?.match(
            /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/,
          )?.[0] || null;
      const monthNumber = {
        January: "01",
        February: "02",
        March: "03",
        April: "04",
        May: "05",
        June: "06",
        July: "07",
        August: "08",
        September: "09",
        October: "10",
        November: "11",
        December: "12",
      };
      const dateParts = dateText?.match(
        /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
      );
      const matchDate = dateParts
        ? `${dateParts[3]}-${monthNumber[dateParts[2]]}-${dateParts[1].padStart(2, "0")}`
        : null;
      const teams = [...node.querySelectorAll('[class*="match-row_team__"]')];
      const getTeam = (team) => ({
        name:
          team?.querySelector(".d-none.d-md-block")?.textContent?.trim() || null,
        code:
          team
            ?.querySelector('[class*="team-abbreviations_container__"]')
            ?.textContent?.trim() || null,
        flag:
          team?.querySelector("img")?.getAttribute("srcset")?.split(" ")[0] ||
          null,
      });
      const scores = [...node.querySelectorAll('[class*="match-row_score__"]')].map(
        (score) => Number(score.textContent?.trim()),
      );
      const labels = [
        ...node.querySelectorAll('[class*="match-row_bottomLabel__"]'),
      ].map((label) => label.textContent?.trim());
      const venueLabels = [
        ...node.querySelectorAll('[class*="match-row_stadiumCityLabels__"] span'),
      ].map((label) => label.textContent?.trim());

      return {
        id: node.getAttribute("href")?.split("/").pop(),
        matchNumber: index + 1,
        url: new URL(node.getAttribute("href"), location.origin).href,
        home: getTeam(teams[0]),
        away: getTeam(teams[1]),
        homeScore: Number.isFinite(scores[0]) ? scores[0] : null,
        awayScore: Number.isFinite(scores[1]) ? scores[1] : null,
        status:
          node
            .querySelector('[class*="match-row_statusLabel__"]')
            ?.textContent?.trim() || "Scheduled",
        dateLabel: dateText,
        matchDate,
        stage: labels[0] || null,
        group: labels[1] || null,
        venue: venueLabels[0] || null,
        city: venueLabels[1]?.replace(/[()]/g, "") || null,
      };
    }),
  );
}

async function collectStandings(page) {
  const url = `${base}/standings`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForContent(page, "table", 10_000);

  return page.locator("table").evaluateAll((tables) =>
    tables.slice(0, 12).map((table) => ({
      group:
        table.querySelector("caption")?.textContent?.match(/Group [A-L]/)?.[0] ||
        "Group",
      teams: [...table.querySelectorAll("tbody tr")].map((row) => {
        const cells = [...row.querySelectorAll("td")];
        const link = row.querySelector('a[href*="/teams/"]');
        const stats = cells
          .slice(3, 12)
          .map((cell) => Number(cell.textContent?.trim()));
        return {
          position: Number(cells[1]?.textContent?.trim()),
          name:
            link?.getAttribute("aria-label") ||
            link?.querySelector(".d-none.d-md-1024-block")?.textContent?.trim() ||
            null,
          code:
            row
              .querySelector('[class*="team-abbreviations_container__"]')
              ?.textContent?.trim() || null,
          flag:
            row.querySelector("img")?.getAttribute("srcset")?.split(" ")[0] ||
            null,
          played: stats[0],
          won: stats[1],
          drawn: stats[2],
          lost: stats[3],
          goalsFor: stats[4],
          goalsAgainst: stats[5],
          goalDifference: stats[6],
          conductScore: stats[7],
          points: stats[8],
          qualified: /qualified/i.test(row.getAttribute("aria-label") || ""),
        };
      }),
    })),
  );
}

async function collectStandingsWithRetry(browser, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const page = await browser.newPage({ locale: "en-US" });
    try {
      const standings = await collectStandings(page);
      if (!isValidStandings(standings)) {
        throw new Error(`FIFA standings returned ${standings.length} valid groups`);
      }
      return standings;
    } catch (error) {
      lastError = error;
      console.warn(
        `FIFA standings attempt ${attempt}/${attempts} failed: ${conciseError(error)}`,
      );
    } finally {
      await page.close();
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

const browser = await chromium.launch({ headless: true });
try {
  const cached = await readCachedReport();
  const page = await browser.newPage({
    locale: "en-US",
    timezoneId: "Asia/Singapore",
    viewport: { width: 1440, height: 1000 },
  });
  const fixtures = await collectFixtures(page);
  let standings;
  let standingsSnapshot;
  try {
    standings = await collectStandingsWithRetry(browser);
    standingsSnapshot = {
      status: "verified",
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (!isValidStandings(cached?.standings)) throw error;
    standings = cached.standings;
    standingsSnapshot = {
      status: "cached",
      capturedAt:
        cached.standingsSnapshot?.capturedAt || cached.generatedAt,
      lastAttemptAt: new Date().toISOString(),
      warning: `FIFA standings unavailable after 3 attempts: ${conciseError(error)}`,
    };
    console.warn(`${standingsSnapshot.warning}. Retaining last verified standings.`);
  }

  const completed = fixtures.filter((match) => match.status === "FT");
  const live = fixtures.filter((match) => !["FT", "Scheduled"].includes(match.status));
  const scheduled = fixtures.filter((match) => match.status !== "FT");
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      name: "FIFA",
      tournamentUrl: base,
      fixturesUrl: `${base}/scores-fixtures`,
      standingsUrl: `${base}/standings`,
    },
    tournament: {
      name: "World Cup 2026",
      totalMatches: fixtures.length,
      completedMatches: completed.length,
      remainingMatches: scheduled.length,
      liveMatches: live.length,
    },
    fixtures,
    standings,
    standingsSnapshot,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      fixtures: fixtures.length,
      completed: completed.length,
      groups: standings.length,
    }),
  );
} finally {
  await browser.close();
}
