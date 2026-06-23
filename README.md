# ORACLE 26

A responsive, dark-theme World Cup intelligence dashboard built for GitHub
Pages. The current phase displays verified tournament facts and deliberately
locks predictions until model backtesting and calibration pass.

This package answers one question before dashboard development begins:

> Which World Cup predictor fields can be populated from traceable, current
> sources without inventing values?

The scheduled pipeline probes FIFA's rendered public pages, checks reputable
supplemental sources, and writes:

- `outputs/data-availability.json` — machine-readable evidence
- `outputs/data-availability.md` — human-readable coverage report

Every field is classified as:

- `verified` — observed directly during the current run
- `derivable` — computable from verified source fields
- `unavailable` — not observed or not consistently structured
- `blocked` — access, licensing, or authentication prevents dependable use

No missing value is converted to zero, estimated, or silently substituted.

## Run locally

```bash
pnpm install
pnpm exec playwright install chromium
pnpm run refresh
pnpm run serve
```

Open `http://localhost:4173`.

## Current product phase

- Responsive command center
- Current fixtures, results and all 12 group tables
- Match search and status filtering
- Official-stat team comparison
- Model methodology and release gates
- Calibrated Elo-Poisson match probabilities
- Held-out backtest performance metrics
- Scheduled six-hour browser collection
- Automated GitHub Pages deployment

Match predictions are published after passing the baseline validation gates.
Exact tournament winner probability remains locked until the official 48-team
bracket simulation is implemented and validated.

## Intended production architecture

GitHub Actions runs the collector on a schedule and commits only validated JSON.
GitHub Pages remains a static consumer and never receives API keys.

Rendered-browser extraction is a fallback. Structured licensed APIs should be
preferred whenever available because browser selectors and page layouts can
change without notice.
