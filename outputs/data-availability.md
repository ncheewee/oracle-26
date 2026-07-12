# ORACLE 26 data availability

Generated: 2026-07-12T09:12:52.807Z

This report records observed evidence, not assumptions. Missing fields must
render as **Unavailable** in the product.

## Summary

- Verified: 33
- Derivable: 7
- Unavailable: 4
- Blocked: 3
- FIFA fixture links observed: 104
- Match pages sampled: 5

## Field coverage

| Field | Status | Source | Evidence |
|---|---|---|---|
| fixtures | verified | FIFA rendered fixtures | Observed label: Match Fixtures |
| results | verified | FIFA rendered fixtures | Observed label: FT |
| kickoff | verified | FIFA rendered fixtures | Observed label: Match Time |
| stage | verified | FIFA rendered fixtures | Observed label: First Stage |
| group | verified | FIFA rendered fixtures | Observed label: Group |
| venue | verified | FIFA rendered fixtures | Observed label: Stadium |
| standings | unavailable | FIFA rendered standings | Checked standings table labels |
| official_ranking | verified | FIFA ranking | Last official update: 11 June 2026 |
| lineups | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| events | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| possession | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| goals | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| attempts | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| shots_on_target | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| final_third_entries | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| offers_to_receive | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| line_breaks | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| cards | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| fouls | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| offsides | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| passes | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| crosses | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| corners | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| free_kicks | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| forced_turnovers | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| pressing | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| player_distance | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| player_speed | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| player_sprints | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| recent_form | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| head_to_head | verified | FIFA rendered match centre | Observed in 5/5 sampled matches |
| squad | verified | FIFA team pages | 2 team links observed on sampled match page |
| fifa_reuse_permission | blocked | FIFA Terms of Service | Terms restrict content reuse; legal review or written permission remains advisable |
| historical_event_training_data | verified | StatsBomb Open Data | 11 World Cup competition-season records found |
| weather | verified | Open-Meteo | HTTP 200; venue coordinates must be mapped |
| backup_fixtures | blocked | football-data.org | HTTP 403; API token may be required |
| injuries | unavailable | Current audited sources | Not consistently structured across all teams and matches |
| player_availability | unavailable | Current audited sources | Not consistently structured across all teams and matches |
| expected_goals | unavailable | Current audited sources | Not consistently structured across all teams and matches |
| market_consensus | blocked | Licensed odds provider required | Excluded from initial public build |
| attack_rating | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |
| defence_rating | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |
| form_rating | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |
| match_probabilities | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |
| predicted_score | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |
| tournament_win_probability | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |
| model_confidence | derivable | ORACLE 26 model | Computed only from validated inputs and labelled as a model estimate |

## Decision

The dashboard may display only fields marked **verified** or **derivable**.
Browser extraction is an operational fallback, not evidence of a redistribution
licence. FIFA attribution, links, conservative request rates, and a legal review
remain required before public launch.
