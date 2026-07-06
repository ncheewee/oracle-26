import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import process from "node:process";
import { materiallyEqual } from "../lib/material-change.mjs";

const defaultFiles = [
  "outputs/data-availability.json",
  "outputs/worldcup.json",
  "outputs/model.json",
  "outputs/tournament-simulation.json",
  "outputs/prediction-history.json",
  "outputs/market-odds.json",
];
const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles;

function previousFile(file) {
  try {
    return execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" });
  } catch {
    return null;
  }
}

for (const file of files) {
  const previousText = previousFile(file);
  if (previousText === null) continue;
  const currentText = await fs.readFile(file, "utf8");
  let previous;
  let current;
  try {
    previous = JSON.parse(previousText);
    current = JSON.parse(currentText);
  } catch {
    console.warn(`Skipping non-JSON material comparison for ${file}`);
    continue;
  }
  if (!materiallyEqual(file, previous, current)) {
    console.log(`Material change retained: ${file}`);
    continue;
  }
  await fs.writeFile(file, previousText);
  console.log(`Timestamp-only change restored: ${file}`);

  if (file === "outputs/data-availability.json") {
    const markdown = "outputs/data-availability.md";
    const previousMarkdown = previousFile(markdown);
    if (previousMarkdown !== null) await fs.writeFile(markdown, previousMarkdown);
  }
}
