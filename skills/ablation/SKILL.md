---
name: ablation
description: Empirically test whether a steering component — a CLAUDE.md line or cluster, a rule file, a skill step, an instruction block — still earns its place, by running matched tasks with and without it and comparing behavior; or test whether a proposed rewrite of it does better, by swapping the two wordings at the same site. Verdicts are load-bearing, ceremony, or harmful (removal) and original-better, replacement-better, or no-difference (rewrite comparison), each stamped with model and date because they expire on model upgrade. Use when auditing steering for bloat, when a rule's value is doubted, when choosing between two wordings of a rule, after a model upgrade, on a scheduled steering-maintenance pass, or when the user says "ablate", "delete and see", "ceremony check", "is this line still needed", or "is this rewrite better".
---

# Ablation

Steering accretes; models improve; yesterday's load-bearing line is today's ceremony — and nobody notices, because a line's presence is never tested, only its absence feared. Ablation is the test: remove the component, observe, and let behavior — not the memory of why the line was added — decide.

Scope: this tests steering NECESSITY (does behavior degrade without the component). Testing a task specification before dispatch is a different job, and benchmarking a skill's overall performance is an eval harness's job.

## Three tiers — cheapest sufficient first

**Tier 1 — Remove it and live without it (cheapest, slowest).** Stash the component; work normally for a defined period or N sessions; restore only when the model demonstrably stumbles on the thing the component prevented. Zero setup, weakest attribution (concurrent changes confound). Right for low-risk lines, whole-file audits, and post-model-upgrade sweeps.

**Tier 2 — Read it and name the concrete failure (instant, weakest).** For each line ask: what observable behavior changes if this is deleted? If no concrete failure can be named, mark it ceremony-candidate. This verdict is assertion, not evidence — promote candidates to tier 3 before deleting anything that has a violation history.

**Tier 3 — Side-by-side test with blind judging (expensive, strongest). Automated.** Draft the frame — the intended effect as a checkable criterion plus a set of realistic, distinct tasks — and get human approval; then launch [scripts/tier3-arms.workflow.js](scripts/tier3-arms.workflow.js). Everything after approval is code, not judgment; an invalid frame fails loud before any agent spawns, including one too small to reach its pre-registered significance level even on perfect data.

**Spend the budget on distinct tasks, not repeats.** Repeats of the same task are strongly correlated — roughly 0.9 as measured here — so three repeats carry about as much independent evidence as five, and the eighth task buys far more than the fourth repeat. Every run reports the smallest difference its design could have detected: 8 tasks × 3 reps sees about 59 points, 17 tasks about 41, 60 tasks about 22. Published steering effects run −10 to +30 points, so a frame below roughly 20 tasks cannot see a typical real effect, and its nulls say more about the design than about the text. Cost: 8 tasks × 3 reps is 48 workers plus 24–48 graders.

## Two questions, one instrument

**Removal mode (default) — "is this text needed?"** Arm B is arm A with the component deleted. Verdicts: LOAD-BEARING / CEREMONY / HARMFUL.

**Substitution mode — "is this rewrite better?"** Pass a `replacement` and arm B swaps it in at the same single site; removal is the empty-replacement case. Verdicts: ORIGINAL-BETTER / REPLACEMENT-BETTER / NO-DIFFERENCE. Use it when a HARMFUL or ceremony-candidate verdict prompts a rewrite, or when choosing between two candidate wordings of a rule.

Every gate holds in both modes because the arms still differ at exactly one site: exact-once occurrence locates that site, the blinding gates check *every* version in play (a probe or criterion quoting either wording is refused), the swap is spliced literally, and the two arms are compared after normalization so a frame that produces identical texts is refused rather than run.

**Substitution mode is a separate measurement claim and carries its own calibration.** Its verdicts count only once three runs are recorded in VALIDATION.md for the worker/grader configuration in use: a positive control (a clear wording recovered as ORIGINAL-BETTER against a deliberately vague rewrite of it), a meaning-preserving placebo (a cosmetic rewrite returning NO-DIFFERENCE), and a length placebo (the same substance at markedly different length, also returning NO-DIFFERENCE — the check for verbosity bias, which the first two cannot catch). Until the frame attests calibration via `calibratedBy`, runs stamp UNCALIBRATED into their own report and their rendered verdict is styled as hedged, not clean. **Calibrated as of 2026-08-10 for workers+graders claude-sonnet-5 (medium) on mechanically-checkable criteria** — all three controls passed (positive p=4.8e-7; both placebos symmetric noise, no verbosity bias at a 3.4x length ratio). Quality-shaped criteria and other model tiers are not covered by that record.

## Output

Per component: verdict, one line of probe evidence, the action (keep / delete / rewrite / promote to enforcement), and the stamp — model, date, probe and rep counts. Verdicts in plain terms — user-facing reports use these literal labels, with the internal names kept in the data: LOAD-BEARING = NEEDED (worse without it); CEREMONY = NOT NEEDED (no detectable difference at this sample size); HARMFUL = DOING HARM (better without it); UNRESOLVED = INCONCLUSIVE (the test could not tell). The stamp is load-bearing: every verdict is indexed to the model that produced it and silently expires on upgrade; a stamped verdict tells the next auditor exactly what is stale.

## Rules

- One component per tier-3 test; ablating clusters confounds attribution. Clusters may share a tier-1 pass. In substitution mode the same rule binds the rewrite: change one site, not a general redraft — two independently authored versions differ in many ways at once and no verdict from them is attributable.
- Never delete on tier 2 alone when the component has a violation history — history is evidence it was load-bearing at some past date; re-earn the deletion at tier 3.
- Keep the removed text verbatim in the report, so restoration is a paste, not archaeology.
- Run on a cadence, not once: after each model upgrade, or as a scheduled maintenance routine. Ablation once is a cleanup; ablation on cadence is what keeps steering lean.

## Bounds of a tier-3 verdict

- Tier 3 is a screening design: fixed thresholds decide the verdict. Since 2026-08-09 every run also reports exact statistics — a one-sided McNemar sign-test p-value per probe and pooled, and 95% Clopper-Pearson intervals on pass rates — quantifying the strength of the evidence, but they do not change the verdict rule. A verdict is a screening signal that justifies its recommended action — never a population claim, and only as generalizable as the probes are representative.
- **A null never authorizes deletion.** CEREMONY means "no difference was detected at this n" — this design can miss real effects and cannot distinguish that from their absence. Deleting on it requires a second, independent check: a human adjudicating a blind sample of the archived pairs, or a deterministic check of the criterion. Raising reps is not that check — repeats of one task are correlated (~0.9 measured), so they add almost no independent evidence; add distinct tasks instead.
- Verdicts are uncalibrated until a positive control (known load-bearing component recovered as LOAD-BEARING) and a placebo (irrelevant line returning CEREMONY) are recorded in VALIDATION.md — per worker/grader configuration, and per mode: removal calibration buys nothing for substitution.
- Blinding is label-level: a criterion that paraphrases the component's wording un-blinds the grader through output content. Phrase criteria as observable outcome properties; the template rejects only verbatim containment — paraphrase leakage is on the frame author. **This risk is strictly larger in substitution mode:** removal's tell is text-versus-silence, but two live wordings each stamp their own register and structure onto outputs, so a grader can sense which arm produced an answer without either version being quoted. Nothing mechanical catches style leakage.
- Substitution's null hypothesis is weaker than removal's. A deleted span cannot produce a directional effect, so "no difference" really is noise; two live wordings can help *different* probes and cancel in the pool. Threshold-crossing conflicts do surface (opposite-direction probes yield UNRESOLVED, never a verdict), but sub-threshold task-dependent effects can read as NO-DIFFERENCE. Treat NO-DIFFERENCE in substitution mode as "no difference detected on these probes", never as equivalence.
- A one-site swap does not control length, token count, specificity, or paragraph structure — any of which can drive the result instead of the meaning. The template reports both versions' size so the confound is visible; equalizing it is the frame author's job.
- Grader–worker independence is not established when both share a model family; prefer a different family or tier for the grader, and spot-check one probe's outputs by hand before a CEREMONY verdict authorizes deletion.
- A re-run after UNRESOLVED with any change to criterion or probes voids the pre-registration: fresh human approval, incremented attempt number in the frame (the template stamps lineage).

## The deepest cut

A LOAD-BEARING verdict on a prose rule is also an argument to move it up the enforcement ladder: if the model reliably misbehaves without the line, a deterministic mechanism (hook, permission, required field) retires the line entirely. The strongest outcome of an ablation is not keeping the component — it is replacing it with structure that makes the component unnecessary.

## Worked example

Component: CLAUDE.md line "Always run the linter before committing." Violation history exists (commits failed CI lint before the line) — skip tier 2. Probes: eight distinct commit-worthy edits spanning bug-fix, refactor and new-feature work, three reps each. With the line: 22/24 lint before committing. Without: 3/24. Verdict: LOAD-BEARING (model + date stamped, 8 tasks × 3 reps, 19 forced picks pooled, p well under alpha) — keep, and propose a pre-commit hook, which would retire the line.

Note the shape: the evidence comes from *task count*, not repetition. Eight tasks at three reps detects what three tasks at five reps cannot, for fewer calls.

## References

- Method: the delete-and-observe technique as described by Claude Code's creator, and the delete-test in the Claude Code docs — <https://code.claude.com/docs/en/best-practices>. Each claim this skill rests on is mapped to its verbatim supporting text, source and verification date in the plugin repo's [docs/research/ablation-claims.md](https://github.com/TheRealBillSiegler/claude-plugins/blob/main/docs/research/ablation-claims.md), with the dated captures beside it.
- Verdict expiry: behaviour shifts enough between model versions to invalidate a stamped verdict, and vendor migration guidance instructs removing instructions tuned for earlier models — <https://platform.claude.com/docs/en/docs/about-claude/models/migrating-to-claude-4>.
- Everything used to build and verify this skill — the test for the workflow script, the report renderer, the validation record, and the raw calibration outputs — lives in the plugin repo under [evals/ablation/](https://github.com/TheRealBillSiegler/claude-plugins/tree/main/evals/ablation) and [docs/research/](https://github.com/TheRealBillSiegler/claude-plugins/tree/main/docs/research), not in the installed payload.
