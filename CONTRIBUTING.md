# Contributing

Feature branch → PR into `develop`; releases merge `develop` → `main` by PR — `main` is what the marketplace serves, so nothing reaches an installer until that second merge. No direct pushes to either. Conventional commits.

## Before you push

Run from the repo root:

```bash
node --test evals/tier3-arms.test.mjs   # the workflow script's own checks
node scripts/check-links.js             # links resolve; the shipped payload is self-contained
```

CI runs the same, plus the version guard: any change under the shipped payload (`skills/`, `.claude-plugin/`) must raise the version in `.claude-plugin/plugin.json`.

## Reporting problems

Open a [GitHub issue](https://github.com/TheRealBillSiegler/ablation/issues).
