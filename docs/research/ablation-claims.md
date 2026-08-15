# Claims — ablation

Every external claim this skill relies on, with the exact text supporting it. One row per claim rather than per source, so a drift check tells you *which claim* broke rather than that a page moved.

Raw captures sit beside this file and are the fallback when a claim turns out to be missing from the table. Captures are dated; the web is not — re-verify against the live URL before leaning on any row for a durable claim.

**Status:** `verified` — quote confirmed against the source on the date shown · `stale` — capture older than the source's last known change · `superseded` — source now says something different · `UNVERIFIED` — no primary source read.

## Claims

| # | Claim as used in the skill | Supporting text (verbatim) | Source | Local capture | Verified | Status |
|---|---|---|---|---|---|---|
| 1 | Ablation means removing parts of a prompt to measure each part's contribution | "you delete the entire system prompt and then you bring it back line by line to figure out what is the impact of each individual line… ablation essentially it's a eval [sic] but you delete things to figure out the impact" | Boris Cherny (Claude Code's creator), interview [00:06:01], YouTube `qyPCVqFUyDo` | [boris-cherny-interview-qyPCVqFUyDo.txt](boris-cherny-interview-qyPCVqFUyDo.txt) | 2026-08-07 | verified |
| 2 | Steering artifacts should be re-tested on a cadence, not trusted indefinitely | "every six months, delete your cloudmd [sic], delete your skills, delete your hooks, see what the model does, and it might surprise you" | Boris Cherny, same interview [00:07:00] | [same](boris-cherny-interview-qyPCVqFUyDo.txt) | 2026-08-07 | verified |
| 3 | The delete-test is published guidance, not only an interview remark | "Keep it concise. For each line, ask: *'Would removing this cause Claude to make mistakes?'* If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" | <https://code.claude.com/docs/en/best-practices> | [claude-code-best-practices.md](claude-code-best-practices-2026-08-06.md) | 2026-08-06 | verified |
| 4 | Behaviour shifts enough across model versions to expire a verdict | GPT-4 fell 84% → 51% on an identical task between two dated versions | arXiv:2307.09009 | none | 2026-08-06 | UNVERIFIED — abstract only |
| 5 | Removing instructions tuned for earlier models is vendor-recommended on upgrade | Migration guidance instructs removing instructions carried over from prompts tuned for earlier models | <https://platform.claude.com/docs/en/docs/about-claude/models/migrating-to-claude-4> | none | 2026-08-06 | verified |
| 6 | Most steering artifacts show no measurable effect — CEREMONY is the expected result | 39 of 49 public skills ≈ zero effect; 7 helpful (to +30pp); 3 harmful (to −10pp) | arXiv:2603.15401 (SWE-Skills-Bench) | none | 2026-08-09 | UNVERIFIED — secondary |

## Notes on the weak rows

Rows 4 and 6 are UNVERIFIED, and neither carries weight. Row 4 supports the expiry *rule*, which stands on row 5 alone. Row 6 sets an expectation, not a threshold — no parameter depends on it. Neither needs upgrading unless it starts doing work.

Rows 4–6 have no local capture, so a silent upstream edit is undetectable for them. Rows 1–3 are self-contained: the skill can travel to another machine and every load-bearing claim remains checkable against a file that travels with it.

## Note on the transcript

Rows 1–2 quote auto-generated captions, which garble product names ("cloudmd" for CLAUDE.md). The garbling is in the source and is preserved rather than silently corrected; `[sic]` marks it. Both passages were confirmed present in the bundled file.

The interview was recorded the day after the Opus 5 release; the transcript was located 2026-08-07. Independent journalism corroborates the same remarks, fetched 2026-08-06: <https://finance.biggo.com/news/954a98de-8b79-429f-bd7e-761c27a3b210> and <https://www.dutchstartup.ai/en/tv/boris-cherny-just-told-us-to-delete-our-claude-md-files>. These are secondary and carry no weight beyond confirming the primary was not misheard.

## What ships

This file and every capture beside it ship with the skill — they are what makes its claims checkable anywhere.

The `calibration-*`, `substitution-*` and `legitimacy-research-*` files in this directory do **not** belong to that set. They are run records from one machine, and calibration is per-configuration and expires on model change, so a stranger's installation inherits none of it. Any packaging step should exclude them; they stay here because [VALIDATION.md](https://github.com/TheRealBillSiegler/claude-plugins/tree/main/evals/ablation) cites them as the evidence behind its verdicts.
