import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const simulationPath = path.join(root, "outputs/tournament-simulation.json");
const historyPath = path.join(root, "outputs/prediction-history.json");

const simulation = JSON.parse(await fs.readFile(simulationPath, "utf8"));

let history = {
  generatedAt: new Date().toISOString(),
  source: "outputs/tournament-simulation.json",
  snapshots: [],
};

try {
  history = JSON.parse(await fs.readFile(historyPath, "utf8"));
} catch {
  // First run: create the history file from the current simulation.
}

const snapshot = {
  generatedAt: simulation.generatedAt,
  simulations: simulation.simulations,
  winner: {
    name: simulation.winner.name,
    champion: simulation.winner.probabilities.champion,
    final: simulation.winner.probabilities.final,
  },
  teams: simulation.teams.slice(0, 12).map((team) => ({
    name: team.name,
    champion: team.probabilities.champion,
    final: team.probabilities.final,
  })),
};

const existingIndex = history.snapshots.findIndex(
  (item) => item.generatedAt === snapshot.generatedAt,
);
if (existingIndex >= 0) {
  history.snapshots[existingIndex] = snapshot;
} else {
  history.snapshots.push(snapshot);
}

history.generatedAt = new Date().toISOString();
history.snapshots.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
history.snapshots = history.snapshots.slice(-240);

await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: "prediction_history_updated",
    snapshots: history.snapshots.length,
    latest: snapshot,
  }),
);
