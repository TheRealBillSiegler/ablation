#!/usr/bin/env node
// Adapt tier3-arms run outputs into the generic report JSON consumed by
// skill-validation's render-report.mjs. Accepts task .output wrappers or bare result objects.
// Presentation layer: translates internal verdict/field names into plain, literal English;
// the underlying data files keep the stable enum contract.
// Usage: node tier3-report.mjs <title> <out.json> <run1.json> [run2.json ...]
import { readFileSync, writeFileSync } from 'node:fs'

const [, , title, outPath, ...runPaths] = process.argv
if (!title || !outPath || !runPaths.length) { console.error('usage: node tier3-report.mjs <title> <out.json> <run1.json> [...]'); process.exit(1) }

const runs = runPaths.map(p => {
  const j = JSON.parse(readFileSync(p, 'utf8'))
  return { path: p, r: j.result && j.result.verdict ? j.result : j }
})

const SHORT = {
  'LOAD-BEARING': 'NEEDED', 'CEREMONY': 'NOT NEEDED', 'HARMFUL': 'DOING HARM', 'UNRESOLVED': 'INCONCLUSIVE',
  'ORIGINAL-BETTER': 'KEEP THE ORIGINAL', 'REPLACEMENT-BETTER': 'USE THE REWRITE', 'NO-DIFFERENCE': 'NO DIFFERENCE',
}
const PLAIN = {
  'LOAD-BEARING': 'NEEDED — behavior got worse without it',
  'CEREMONY': 'NOT NEEDED — no detectable difference at this sample size',
  'HARMFUL': 'DOING HARM — behavior was better without it',
  'UNRESOLVED': 'INCONCLUSIVE — the test could not tell',
  'ORIGINAL-BETTER': 'KEEP THE ORIGINAL — the rewrite did worse',
  'REPLACEMENT-BETTER': 'USE THE REWRITE — it did better than the original',
  'NO-DIFFERENCE': 'NO DIFFERENCE — both wordings performed the same at this sample size',
}
// Run files predating substitution mode carry no armLabels; removal is the correct fallback.
const REMOVAL_LABELS = { a: 'WITH the text', b: 'WITHOUT it', sideA: 'the WITH side', sideB: 'the WITHOUT side' }
const armsOf = r => r.armLabels ?? REMOVAL_LABELS

// -- exact-stats helpers (identical in tier3-arms.workflow.js and tier3-report.mjs; the unit test asserts parity) --
const choose = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r }
// One-sided exact McNemar sign test. b = forced picks favoring WITH, c = favoring WITHOUT. Under
// "the text makes no difference" each forced pick is a fair coin: p = P(Binomial(b+c, 0.5) >= max(b,c)).
const signTest = (b, c) => { const d = b + c; if (d === 0) return null; let s = 0; for (let k = Math.max(b, c); k <= d; k++) s += choose(d, k); return s / 2 ** d }
const binTailGE = (x, n, p) => { let s = 0; for (let k = x; k <= n; k++) s += choose(n, k) * p ** k * (1 - p) ** (n - k); return s }
// Exact (Clopper-Pearson) 95% interval for a pass rate of x out of n, by bisection on the exact binomial tail.
const clopperPearson = (x, n) => {
  const bisect = below => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (below(mid)) lo = mid; else hi = mid } return lo }
  const lower = x === 0 ? 0 : bisect(p => binTailGE(x, n, p) < 0.025)
  const upper = x === n ? 1 : bisect(p => 1 - binTailGE(x + 1, n, p) > 0.025)
  return [Math.round(lower * 1000) / 1000, Math.round(upper * 1000) / 1000]
}
const fmtP = p => p == null ? 'n/a (no forced picks)' : p < 0.001 ? p.toExponential(1) : String(Math.round(p * 1000) / 1000)
// -- end exact-stats helpers --

// Old run files predate the statistics fields; recompute from the counts they do carry, so every
// report renders the same evidence-strength numbers regardless of run vintage.
const statsOf = x => x.stats ?? (x.both == null ? null : (() => {
  const b = x.ctrlPass - x.both, c = x.ablPass - x.both
  return { ctrlOnly: b, ablOnly: c, pOneSided: signTest(b, c), ctrlCI95: x.n ? clopperPearson(x.ctrlPass, x.n) : null, ablCI95: x.n ? clopperPearson(x.ablPass, x.n) : null }
})())
// Never print a rounded "0%" — a tiny probability is not an impossible one; show the floor instead.
const luck = s => {
  if (!s) return '-'
  if (s.pOneSided == null) return 'no forced picks'
  const pct = Math.round(s.pOneSided * 1000) / 10
  return `${pct === 0 ? 'under 0.1' : pct}% (p=${fmtP(s.pOneSided)})`
}
const fmtCI = ci => ci ? `${Math.round(ci[0] * 100)}%–${Math.round(ci[1] * 100)}%` : 'n/a'

// Fallbacks so run files predating each statistics field still render the full report.
const healthOf = r => r.statistics?.health ?? (() => {
  const pairsPlanned = r.design.probes * r.design.repsPerArm
  const workerFailures = r.perProbe.reduce((s, x) => s + (x.droppedFailed ?? 0), 0)
  const hasSplit = r.perProbe.some(x => 'droppedGraderFailed' in x)
  const graderFailures = hasSplit ? r.perProbe.reduce((s, x) => s + (x.droppedGraderFailed ?? 0), 0) : null
  const inconsistentPairs = r.perProbe.reduce((s, x) => s + (x.droppedInconsistent ?? 0), 0)
  const graded = pairsPlanned - workerFailures - (graderFailures ?? 0)
  return { pairsPlanned, workerFailures, graderFailures, inconsistentPairs, workerFailureRate: Math.round(workerFailures / pairsPlanned * 1000) / 10, graderFailureRate: graderFailures != null ? Math.round(graderFailures / pairsPlanned * 1000) / 10 : null, judgeFlipRate: graded > 0 ? Math.round(inconsistentPairs / graded * 1000) / 10 : null }
})()
const pooledOf = r => r.statistics?.pooled ?? (() => {
  const ss = r.perProbe.map(statsOf)
  if (ss.some(s => !s)) return null
  const b = ss.reduce((s, x) => s + x.ctrlOnly, 0), c = ss.reduce((s, x) => s + x.ablOnly, 0)
  return { ctrlOnly: b, ablOnly: c, pOneSided: signTest(b, c) }
})()
const detectOf = r => {
  const det = r.statistics?.detectability
  if (det && det.length && det[0].convertShare != null) return det
  // Recompute design-level sensitivity (also replaces any older observed-count-conditioned tables).
  const usable = r.perProbe.reduce((s, x) => s + x.n, 0)
  const alpha = r.statistics?.alpha ?? 0.05
  const minForced = Math.ceil(-Math.log2(alpha))
  return [0.2, 0.4, 0.6, 0.8].map(f => ({ convertShare: f, chanceCaught: Math.round(binTailGE(minForced, usable, f) * 1000) / 10 }))
}
const famOf = r => r.statistics?.familywise ?? (() => {
  const ps = r.perProbe.map(statsOf).filter(Boolean).map(s => s.pOneSided).filter(p => p != null)
  return ps.length ? Math.round((1 - (1 - Math.min(...ps)) ** r.design.probes) * 10000) / 10000 : null
})()

// Decision rules in plain English first, with the executed formula from tier3-arms.workflow.js in parentheses.
// Parameterized by the run's arm labels and verdict names: the mechanism is identical in both modes,
// only what the two versions ARE differs (removed vs rewritten).
const rulesFor = (L, V) => [
  `A version wins "${V.armA}" for a task when at least two-thirds of the repeats passed ${L.a} and at least two-thirds failed ${L.b}. (per-task flag in the code: degraded = ctrlPass >= ceil(2n/3) && (n - ablPass) >= ceil(2n/3))`,
  `"${V.armB}" is the mirror image: passes ${L.b}, fails ${L.a}. (per-task flag in the code: harmful = ablPass >= ceil(2n/3) && (n - ctrlPass) >= ceil(2n/3))`,
  `"${V.same}" requires every task to show no meaningful gap between the two versions. (allNoDelta: every probe has |ctrlPass - ablPass| <= floor(n/3))`,
  'Any task left with fewer usable repeats than its significance level demands (5 at the standard 0.05 setting; never fewer than 3) makes the whole run INCONCLUSIVE — never guessed around. (lowN = n < max(3, ceil(-log2(alpha))) -> UNRESOLVED)',
  'Every paired answer is judged twice with the labels swapped; it counts only if the judge says the same thing both times. Failed workers and disagreeing judgments are thrown out, not scored.',
  'The report also shows, per task and overall, how often a gap this big would show up by chance IF the text truly made no difference. It is NOT the chance the verdict is wrong. The number is figured for the direction the data leaned; a reader who did not pick a direction in advance should double it. Evidence strength only; it never decides the verdict. (one-sided exact McNemar sign test on the forced picks: p = P(Binomial(b+c, 0.5) >= max(b,c)))',
  'Looking at several tasks gives luck several chances, so the standout task’s fluke chance is also shown corrected for the number of tasks examined. The correction treats tasks as independent — a simplification that errs on the cautious side here, understating significance rather than inflating it. (Sidak: 1 - (1 - min p)^tasks)',
  'Each "What this test could have caught" table supposes the text really matters at fixed strengths and shows the chance the run design reaches the bar — never figured from the observed result, because quoting how good a run was at catching the very effect it happened to see would be circular (statisticians call that "observed power").',
]
const VERDICT_NAMES = {
  removal: { armA: 'NEEDED', armB: 'DOING HARM', same: 'NOT NEEDED' },
  substitution: { armA: 'KEEP THE ORIGINAL', armB: 'USE THE REWRITE', same: 'NO DIFFERENCE' },
  mixed: { armA: 'VERSION A AHEAD', armB: 'VERSION B AHEAD', same: 'NO DIFFERENCE' },
}
const MIXED_LABELS = { a: 'with version A', b: 'with version B', sideA: 'version A', sideB: 'version B' }
// Plain label -> stable internal enum, listed per report so a reader sees only the vocabulary in use.
const REMOVAL_MAP = [['NEEDED', 'LOAD-BEARING'], ['DOING HARM', 'HARMFUL'], ['NOT NEEDED', 'CEREMONY'], ['INCONCLUSIVE', 'UNRESOLVED']]
const SUB_MAP = [['KEEP THE ORIGINAL', 'ORIGINAL-BETTER'], ['USE THE REWRITE', 'REPLACEMENT-BETTER'], ['NO DIFFERENCE', 'NO-DIFFERENCE'], ['INCONCLUSIVE', 'UNRESOLVED']]
const NAME_MAP = { removal: REMOVAL_MAP, substitution: SUB_MAP, mixed: [...REMOVAL_MAP, ...SUB_MAP] }

// Analyst view: one labeled table per question, data-first. Explanatory prose lives in collapsed
// "How to read this" blocks; terms are defined once in the glossary and referenced via {{term}} hover
// tokens; recurring caveats are stated once in finePrint and marked where they apply via {{^n}}.
const trunc = (s, n) => s.length > n ? s.slice(0, n) + '…' : s
const snip = r => trunc(r.componentUnderTest.trim(), 60)

const glossaryFor = L => [
  { term: 'forced pick', def: 'A repeat where the blind judges said one version passed and the other failed — consistently, in both label orders. The only repeats that carry direction.' },
  { term: 'usable repeat', def: 'A repeat that survived to be scored: the worker produced output and the two blind judgings agreed once the labels were swapped.' },
  { term: 'worker', def: 'The model that performed the task and wrote an answer.' },
  { term: 'grader', def: 'The model that compared a pair of answers, blind, against the pre-registered question.' },
  { term: 'the bar', def: 'The significance level (alpha) chosen before the run. A fluke chance at or under the bar counts as statistically clear.' },
  { term: 'fluke chance', def: 'The p-value: how often a gap this big would show up by chance IF the text truly made no difference. Not the chance the verdict is wrong.' },
  { term: 'clear win', def: `A forced pick favoring ${L.sideA}.` },
]
const finePrintFor = L => [
  `Best-case numbers: the hypothetical assumes every changed repeat lands in favor of ${L.sideA} — the rest tie, none go the other way.`,
  'A fluke chance is NOT the chance the verdict is wrong — it answers "how often would luck alone produce this?", assuming the text changed nothing.',
  'Fluke chances are one-sided, figured for the direction the data leaned; a reader who did not pick a direction in advance should double them.',
  'The multiple-looks correction treats tasks as independent — a simplification that errs on the cautious side, understating significance.',
  'Statistics are reported only; they never decide the verdict. The pre-registered screening rules decide.',
]

const summarySection = ({ r }) => ({
  heading: `What was tested — "${snip(r)}"`,
  table: {
    columns: ['Item', 'Detail'],
    rows: [
      ['Verdict', `${PLAIN[r.verdict] || r.verdict} (internal name: ${r.verdict})`],
      [r.mode === 'substitution' ? 'Original wording' : 'Text under test (deleted verbatim in the second version)', r.componentUnderTest.trim()],
      ...(r.mode === 'substitution' ? [['Rewrite it was tested against', String(r.replacementText ?? '').trim()]] : []),
      ...(r.versionShapes ? [['Size of each version (nothing forces these to match — a large gap is itself a possible cause of any difference)', `original ${r.versionShapes.originalChars} characters / ${r.versionShapes.originalLines} lines; rewrite ${r.versionShapes.replacementChars} characters / ${r.versionShapes.replacementLines} lines (${r.versionShapes.deltaChars >= 0 ? '+' : ''}${r.versionShapes.deltaChars})`]] : []),
      ...(r.calibrationNote ? [['Calibration status', r.calibrationNote]] : r.calibratedBy ? [['Calibration status', `Attested by the approved plan: ${r.calibratedBy}`]] : []),
      ['Question the judges answered', r.criterion],
      ['Design', `${r.design.probes} tasks × ${r.design.repsPerArm} repeats × 2 versions (${r.mode === 'substitution' ? 'original / rewrite' : 'with / without'}); every pair judged twice with the labels swapped`],
      ['Model + date stamp — "workers" answered the tasks, "graders" judged the pairs (verdicts expire on model change)', r.stamp],
      ['Attempt', String(r.attempt)],
      ...(r.priorRun ? [['Earlier attempts (operator log, quoted verbatim from the run record)', r.priorRun]] : []),
      ['Recommended action', r.recommendedAction],
    ],
  },
})

const statsSection = ({ r }) => {
  const pooled = pooledOf(r)
  if (!pooled) return null
  const fam = famOf(r)
  const alpha = r.statistics?.alpha
  const L = armsOf(r)
  const rows = [
    ['{{Forced pick}}s — repeats where judges picked a side', `${pooled.ctrlOnly} favored ${L.sideA}, ${pooled.ablOnly} favored ${L.sideB}`],
    ['{{Fluke chance}}, all tasks combined{{^2}}{{^3}}', luck(pooled)],
  ]
  if (fam != null) rows.push([`Standout task, corrected for examining ${r.design.probes} tasks{{^4}}`, `p=${fmtP(fam)}`])
  if (alpha != null) rows.push(['{{The bar}} (alpha, chosen before the run)', String(alpha)])
  return {
    heading: `How strong is the evidence? — "${snip(r)}"`,
    intro: 'Reported only — the pre-registered screening rules decide the verdict.{{^5}}',
    table: { columns: ['What was measured', 'Value'], rows },
    howToRead: [
      'Forced picks: the raw signal — which version won when the judges could tell the answers apart. Ties (both passed / neither passed) carry no direction.',
      'Fluke chance: if the text truly made no difference, a split this lopsided would show up by chance this often.',
      `Standout task: looking at ${r.design.probes} tasks gives luck ${r.design.probes} chances; the correction accounts for that.`,
      'The bar: a fluke chance at or under it counts as statistically clear.',
    ],
  }
}

const resultsSection = ({ r }) => {
  const L = armsOf(r)
  const sub = r.mode === 'substitution'
  return {
  heading: sub ? `Which wording did better, task by task? — "${snip(r)}"` : `Did the text matter, task by task? — "${snip(r)}"`,
  intro: `${r.design.repsPerArm}× ${L.a}, ${r.design.repsPerArm}× ${L.b}, per task; blind judges compared each pair.{{^5}}`,
  howToRead: [
    `What this shows: for each task, the share of {{usable repeat}}s that passed ${L.a} vs ${L.b}.`,
    'How it was judged: every pair was judged twice with the labels swapped; a repeat counts only when the two judgments agree.{{^2}}',
    'Watch out: "Thrown out" repeats are dropped, never scored — few usable repeats weaken every number for that task. A "-" in the grader slot means that run predates separate grader-failure tracking (counted under worker failures).',
    'Drill down: hover a bar for detail; click a task below the table for its rep-by-rep record.',
  ],
  chart: {
    label: `Share of usable repeats that passed, ${L.a} vs ${L.b}, per task`,
    yUnit: '%', yMax: 100,
    series: [`Passed ${L.a}`, `Passed ${L.b}`],
    groups: r.perProbe.map((x, i) => ({
      label: `Task ${i + 1}`,
      values: [x.n ? Math.round(x.ctrlPass / x.n * 100) : 0, x.n ? Math.round(x.ablPass / x.n * 100) : 0],
      short: [`${x.ctrlPass}/${x.n}`, `${x.ablPass}/${x.n}`],
      notes: [`Task ${i + 1}, ${L.a}: ${x.ctrlPass} of ${x.n} usable repeats passed`, `Task ${i + 1}, ${L.b}: ${x.ablPass} of ${x.n} usable repeats passed`],
    })),
  },
  table: {
    columns: ['Task', 'Usable repeats', `Passed ${L.a}`, `Passed ${L.b}`, 'Judges: both passed', 'Judges: neither passed', 'Judges: picked one side', 'Thrown out (worker failed / grader failed / judges disagreed)', '{{Fluke chance}} for this task{{^2}}{{^3}}', 'Result for this task'],
    rows: r.perProbe.map((x, i) => [
      `Task ${i + 1}`, x.n, `${x.ctrlPass} of ${x.n}`, `${x.ablPass} of ${x.n}`, x.both ?? '-', x.neither ?? '-',
      x.both != null ? x.n - x.both - x.neither : '-', `${x.droppedFailed ?? 0} / ${'droppedGraderFailed' in x ? x.droppedGraderFailed : '-'} / ${x.droppedInconsistent ?? 0}`,
      luck(statsOf(x)),
      x.lowN ? 'TOO FEW USABLE REPEATS' : x.degraded ? (sub ? 'ORIGINAL DID BETTER' : 'WORSE WITHOUT IT') : x.harmful ? (sub ? 'REWRITE DID BETTER' : 'BETTER WITHOUT IT') : 'no difference',
    ]),
  },
  drilldown: r.perProbe.map((x, i) => {
    const s = statsOf(x)
    const ciLine = s?.ctrlCI95 ? [`Estimated pass-rate range (95% confidence interval, exact method — the true rate is very likely inside, not guaranteed; wide ranges mean few repeats and little resolving power): ${L.a} ${fmtCI(s.ctrlCI95)}, ${L.b} ${fmtCI(s.ablCI95)}.`] : []
    return {
      summary: `Task ${i + 1}: ${x.probe.slice(0, 110)}${x.probe.length > 110 ? '…' : ''} — rep-by-rep record (${x.evidence.length} entries)`,
      body: [...ciLine, ...(x.evidence.length ? x.evidence : ['(no usable judged repeats for this task)'])],
    }
  }),
  }
}

// One sensitivity section per run: what this run's design could have caught, independent of what it saw.
const detectSection = ({ r }) => {
  const det = detectOf(r)
  if (!det) return null
  const pooled = pooledOf(r)
  const d = pooled ? pooled.ctrlOnly + pooled.ablOnly : 0
  const alpha = r.statistics?.alpha ?? 0.05
  const minForced = r.statistics?.minForcedToReachBar ?? Math.ceil(-Math.log2(alpha))
  const usable = r.statistics?.usablePairs ?? r.perProbe.reduce((s, x) => s + x.n, 0)
  const floorLine = d < minForced
    ? ` This run produced ${d} {{forced pick}}${d === 1 ? '' : 's'} — fewer than the ${minForced} needed to reach {{the bar}}, so no result could have cleared it regardless of effect size; expected when a text changes nothing.`
    : ` This run produced ${d} {{forced pick}}s (${minForced} needed to reach {{the bar}}).`
  const L = armsOf(r)
  const helper = r.mode === 'substitution' ? 'one wording really did beat the other' : 'the text really did help'
  return {
    heading: `Could this test have seen a difference at all? — "${snip(r)}"`,
    intro: `If ${helper}, would this run have noticed? Each row imagines a different size of "really better" — from changing the result in 20% of tries to 80% — and shows the chance this test would have caught it.{{^1}}${floorLine}`,
    howToRead: [
      `How it was figured: detection chance = the chance that at least ${minForced} of the ${usable} {{usable repeat}}s become {{clear win}}s for ${L.sideA}, when each repeat converts with the row's probability.{{^1}}`,
      'Watch out: always figured at fixed hypothetical strengths, never from the observed result — quoting how good a run was at catching the very effect it happened to see would be circular (statisticians call that "observed power").',
    ],
    chart: {
      label: 'Chance this design catches an effect, by hypothetical effect strength',
      yUnit: '%', yMax: 100,
      groups: det.map(x => ({
        label: `${Math.round(x.convertShare * 100)}% converted`,
        values: [x.chanceCaught],
        short: [`${x.chanceCaught}%`],
        notes: [`If ${Math.round(x.convertShare * 100)}% of repeats became clear wins for ${L.sideA}, this design would catch it ${x.chanceCaught}% of the time (best case)`],
      })),
    },
    table: {
      columns: [`If this share of repeats really became clear wins for ${L.sideA}`, 'Chance this design would have caught it (best case)'],
      rows: det.map(x => [`${Math.round(x.convertShare * 100)}%`, `${x.chanceCaught}%`]),
    },
  }
}

// One instrument-health section for the whole report: how much planned data survived to be scored.
const healthSection = allRuns => ({
  heading: 'Was the data any good?',
  intro: 'How much of the planned data survived to be scored.',
  howToRead: [
    'Three ways to lose a repeat: the {{worker}} produces no usable output, a {{grader}} call fails outright, or the two blind judgings disagree once the labels are swapped.',
    'Why it matters: lost repeats are thrown out, never scored — high loss makes the run less able to see anything (wide ranges, weak fluke-chances above).',
    '"Not separated in this run": older runs counted grader failures under worker failures.',
  ],
  table: {
    columns: ['Text under test', 'Planned pairs', 'Worker failures', 'Grader failures', 'Judges flipped when labels swapped', 'Share of planned data that survived'],
    rows: allRuns.map(({ r }) => {
      const h = healthOf(r)
      const survived = h.pairsPlanned - h.workerFailures - (h.graderFailures ?? 0) - h.inconsistentPairs
      return [`"${r.componentUnderTest.trim().slice(0, 60)}"`, h.pairsPlanned, `${h.workerFailures} (${h.workerFailureRate}%)`, h.graderFailures != null ? `${h.graderFailures} (${h.graderFailureRate}%)` : 'not separated in this run (counted under worker failures)', `${h.inconsistentPairs}${h.judgeFlipRate != null ? ` (${h.judgeFlipRate}% of graded)` : ''}`, `${survived} of ${h.pairsPlanned} (${Math.round(survived / h.pairsPlanned * 1000) / 10}%)`]
    }),
  },
})

const overall = runs.map(({ r }) => r.verdict)
const passSums = ({ r }) => {
  const n = r.perProbe.reduce((s, x) => s + x.n, 0)
  return { withPass: r.perProbe.reduce((s, x) => s + x.ctrlPass, 0), withoutPass: r.perProbe.reduce((s, x) => s + x.ablPass, 0), n }
}
// Report-level labels: single-mode reports speak that mode's language; a mixed report falls back to
// neutral version-A/version-B wording rather than picking one mode's vocabulary for both.
const modes = new Set(runs.map(({ r }) => r.mode ?? 'removal'))
const reportMode = modes.size > 1 ? 'mixed' : [...modes][0]
const RL = reportMode === 'mixed' ? MIXED_LABELS : armsOf(runs[0].r)
const anySub = modes.has('substitution')
const report = {
  title,
  stamp: runs.map(({ r }) => r.stamp).join(' | '),
  verdict: overall.map(v => SHORT[v] || v).join(' + '),
  // An uncalibrated run never renders clean: the styling has to carry the same hedge the text does.
  verdictClass: runs.some(({ r }) => r.calibrationNote) ? 'warn'
    : overall.every(v => ['LOAD-BEARING', 'CEREMONY', 'ORIGINAL-BETTER', 'REPLACEMENT-BETTER', 'NO-DIFFERENCE'].includes(v)) ? 'good'
    : overall.some(v => v === 'HARMFUL') ? 'bad' : 'warn',
  banner: [
    ...runs.filter(({ r }) => r.calibrationNote).map(() => 'UNCALIBRATED — read the calibration status before trusting these verdicts.'),
    ...runs.map(run => {
      const { withPass, withoutPass, n } = passSums(run)
      const L = armsOf(run.r)
      return `"${trunc(run.r.componentUnderTest.trim(), 70)}" -> ${SHORT[run.r.verdict] || run.r.verdict}: passed ${withPass} of ${n} ${L.a}, ${withoutPass} of ${n} ${L.b}`
    }),
  ].join('  |  '),
  rules: rulesFor(RL, VERDICT_NAMES[reportMode]),
  // Only the vocabulary this report actually uses — carrying both modes' names would put removal
  // verdicts in front of a reader looking at a rewrite comparison, and vice versa.
  rulesNote: `The verdict cutoffs are screening rules with fixed constants; the fluke-chance numbers (p-values) and 95% ranges are exact statistics reported alongside them (added 2026-08-09) so the strength of each verdict is visible. "${VERDICT_NAMES[reportMode].same}" means "no difference detected at this sample size" — weaker than proof that the two versions are equivalent. Internal verdict names in the raw data for this report: ${NAME_MAP[reportMode].map(([plain, internal]) => `${plain}=${internal}`).join(', ')}.`,
  glossary: glossaryFor(RL),
  finePrint: finePrintFor(RL),
  sections: [...runs.flatMap(run => [summarySection(run), statsSection(run), resultsSection(run), detectSection(run)]).filter(Boolean), healthSection(runs)],
  provenance: [
    ...runPaths.map(p => ({ label: `raw run data: ${p.split(/[\\/]/).pop()}`, href: p.split(/[\\/]/).pop() })),
    { label: 'validation history: VALIDATION.md', href: '../VALIDATION.md' },
    { label: 'the test program that produced this data: tier3-arms.workflow.js', href: '../scripts/tier3-arms.workflow.js' },
  ],
  notes: anySub ? [
    'Comparing two wordings is a different measurement claim than deleting one, and carries its own calibration requirement: for this worker/grader configuration, a clearly better wording must be recovered, a meaning-preserving rewrite must return NO DIFFERENCE, and a much longer rewrite of the same substance must also return NO DIFFERENCE (the check for length bias). Until all three are recorded in VALIDATION.md, treat rewrite verdicts here as uncalibrated.',
    'Known limit of comparing two live wordings: with text in both versions, the answers can carry the wording\'s own style, so a judge may sense which version produced an answer without either version being quoted. The automatic checks catch verbatim quoting only; style resemblance is on the person who writes the plan. This risk is larger here than when a text is simply deleted.',
    'Known limit of the fluke-chance math: it treats "no difference" as the two wordings being equally good on every task. If one wording helps some tasks while the other helps others, and neither gap is large enough to trip the two-thirds rule, the run can report no difference when a real task-dependent effect exists. Gaps large enough to trip the rule in opposite directions do surface — as INCONCLUSIVE, not as a verdict.',
  ] : [],
}

writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`report JSON written: ${outPath} (${runs.length} runs)`)
