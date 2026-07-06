const VOLATILE_KEYS = new Set([
  "generatedAt",
  "lastAttemptAt",
  "capturedAt",
  "asOf",
  "warning",
]);

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, normalizeValue(child)]),
  );
}

export function normalizeGeneratedData(file, value) {
  const normalized = normalizeValue(value);
  if (file.endsWith("prediction-history.json") && normalized.snapshots) {
    const unique = [];
    for (const snapshot of normalized.snapshots) {
      const signature = JSON.stringify(snapshot);
      if (signature !== unique.at(-1)?.signature) {
        unique.push({ signature, snapshot });
      }
    }
    normalized.snapshots = unique.map((item) => item.snapshot);
  }
  return normalized;
}

export function materiallyEqual(file, previous, current) {
  return (
    JSON.stringify(normalizeGeneratedData(file, previous)) ===
    JSON.stringify(normalizeGeneratedData(file, current))
  );
}
