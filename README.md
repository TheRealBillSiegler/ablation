# ablation

Tests whether a piece of instruction text still earns its place. Runs the same realistic tasks twice — once with the text, once without — has blind judges compare the paired outputs, and returns a verdict alongside the smallest difference the design could actually have detected. It also answers the rewrite question: given two wordings, is the new one better?

One skill, no hooks — nothing always-on beyond its listing description. The experiment runs only when you ask for it.

| Component | What it does | Fires when |
| --- | --- | --- |
| `skills/ablation/` | Three levels of testing, cheapest first: live without it, reason about it, then the controlled experiment. The experiment is a workflow script, so the rules of the test are enforced by code rather than by remembering them. | You suspect a line has stopped earning its place, you are choosing between two wordings, or a model upgrade has expired an earlier answer |

## Install

**Via the central marketplace**, alongside Bill Siegler's other plugins:

```bash
/plugin marketplace add TheRealBillSiegler/siegler-plugins
/plugin install ablation@siegler-plugins
```

**Direct from this repo**, standalone:

```bash
/plugin marketplace add TheRealBillSiegler/ablation
/plugin install ablation@ablation
```

The doubled name is correct — this repo self-registers as a one-plugin marketplace, so the marketplace name and the plugin name are both `ablation`.

Then restart or run `/reload-plugins` — no install form takes effect in a running session.

## Verify

The instrument has to be checked against reality before its verdicts mean anything: a **positive control**, text you are certain matters, which it must find; and a **placebo**, text you are certain is irrelevant, which it must report as no difference. Both are per worker/grader configuration and expire when the model changes, so a fresh install starts uncalibrated and marks its own reports accordingly.

The workflow script's own test — 31 checks over every frame gate, arm derivation, the grading rule, the tally and the null path, with workers and graders stubbed — lives in the plugin repo: `evals/tier3-arms.test.mjs`. Run it after any edit to the script; `node --check` only parses, and will not catch a reference to a deleted identifier.

## What it will not tell you

A verdict is scoped to the tasks it ran on, the model that produced it, and the date. It is a screening test, not a proof.

"No difference detected" is never "no difference exists" — so every run prints the smallest effect it could have caught, and a null is reported against that number. Deleting on a null alone is refused by the recommended action itself; that needs a second, independent check, either a human adjudicating a blind sample or a deterministic check of the criterion.

The judge is a language model from the same family as the workers, which bounds what blinding can buy. The skill's Bounds section states the limits it cannot mechanically catch.

## Relation to the other plugins

This is the measurement instrument the others' claims rest on. [`delegation-tiering`](https://github.com/TheRealBillSiegler/delegation-tiering) and [`steering-claude-code`](https://github.com/TheRealBillSiegler/steering-claude-code) each make standing claims that certain words improve behaviour; this is how such a claim gets checked rather than assumed. Neither requires it, and it requires neither.

## Source fidelity

Claims carry the same provenance tiers as the sibling plugins, defined in [delegation-tiering's Anchoring policy](https://github.com/TheRealBillSiegler/delegation-tiering/blob/main/docs/REMEDIATION.md#anchoring-policy). The skill's Source section links the live pages behind the method; each claim is mapped to its verbatim supporting text, source and verification date in [docs/research/ablation-claims.md](https://github.com/TheRealBillSiegler/ablation/blob/main/docs/research/ablation-claims.md), with the dated captures beside it.

The claims map, the captures, the script's test, the report renderer, the validation record and the raw calibration outputs all live in the plugin repo — under [docs/research/](https://github.com/TheRealBillSiegler/ablation/tree/main/docs/research) and [evals/](https://github.com/TheRealBillSiegler/ablation/tree/main/evals) — not in the installed payload. The payload carries only what the model reads to do the work.
