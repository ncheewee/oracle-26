const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function evaluateDutchBasket(selections) {
  if (!Array.isArray(selections) || selections.length < 2) {
    throw new Error("A dutch basket needs at least two selections");
  }
  if (
    selections.some(
      (selection) =>
        !Number.isFinite(selection.decimalOdds) ||
        selection.decimalOdds <= 1 ||
        !Number.isFinite(selection.modelProbability) ||
        selection.modelProbability < 0,
    )
  ) {
    throw new Error("Selections need valid decimal odds and model probabilities");
  }

  const reciprocalTotal = selections.reduce(
    (sum, selection) => sum + 1 / selection.decimalOdds,
    0,
  );
  const effectiveOdds = 1 / reciprocalTotal;
  const coverageProbability = selections.reduce(
    (sum, selection) => sum + selection.modelProbability,
    0,
  );
  const expectedReturn =
    ((coverageProbability / 100) * effectiveOdds - 1) * 100;
  const expectedGrossReturn = (coverageProbability / 100) * effectiveOdds;
  const legs = selections.map((selection) => ({
    ...selection,
    stakeShare: round((1 / selection.decimalOdds / reciprocalTotal) * 100),
    singleExpectedReturn: round(
      (selection.modelProbability / 100) * selection.decimalOdds * 100 - 100,
    ),
  }));

  return {
    legs,
    effectiveOdds: round(effectiveOdds, 2),
    coverageProbability: round(coverageProbability),
    breakEvenProbability: round((1 / effectiveOdds) * 100),
    expectedGrossReturn: round(expectedGrossReturn, 2),
    fairOdds: coverageProbability > 0 ? round(100 / coverageProbability, 2) : null,
    expectedReturn: round(expectedReturn),
  };
}

export function findWorthwhileOutrightBaskets(
  championship,
  { limit = 4, minTeamProbability = 2, minCoverage = 20 } = {},
) {
  const eligible = championship.filter(
    (selection) =>
      Number.isFinite(selection.modelProbability) &&
      selection.modelProbability >= minTeamProbability &&
      Number.isFinite(selection.decimalOdds) &&
      selection.decimalOdds > 1,
  );
  const baskets = [];

  for (let first = 0; first < eligible.length; first += 1) {
    for (let second = first + 1; second < eligible.length; second += 1) {
      const basket = evaluateDutchBasket([eligible[first], eligible[second]]);
      if (
        basket.coverageProbability >= minCoverage &&
        basket.expectedReturn > 0
      ) {
        baskets.push(basket);
      }
    }
  }

  return baskets
    .sort(
      (a, b) =>
        b.expectedReturn - a.expectedReturn ||
        b.coverageProbability - a.coverageProbability,
    )
    .slice(0, limit);
}
