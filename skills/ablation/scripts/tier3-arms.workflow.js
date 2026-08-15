// Tier-3 ablation template. Launch via the Workflow tool with args:
// {
//   component: "<verbatim text under test — must appear EXACTLY ONCE in steering>",
//   criterion: "<pre-registered checkable intended effect — an outcome property, never a restatement of the component>",
//   steering: "<full steering context INCLUDING the component; arm B is DERIVED from it, never passed>",
//   replacement: "<optional rewrite>",             // absent/empty = removal mode (arm B deletes the component);
//                                                  // present = substitution mode (arm B swaps this in at the same site)
//   calibratedBy: "<VALIDATION.md reference>",     // substitution mode only: owner attestation that this
//                                                  // config's substitution controls are recorded; absent = verdict hedged
//   probes: ["<realistic task 1>", ...],          // 3-20, human-approved, must not quote EITHER version.
//                                                  // Distinct tasks are the binding constraint on what this can detect:
//                                                  // repeats of one task are correlated (~0.9 measured), so the 8th task
//                                                  // buys far more than the 4th repeat. Spend budget here first.
//   reps: 3,                                       // 3 is near the ceiling of what repeats can buy; alpha is reached by
//                                                  // pooling forced picks across tasks, not by repeating one task
//   alpha: 0.05,                                   // pre-registered significance level; part of the frame, so changing it needs fresh approval
//   workerModel: "sonnet", workerEffort: "medium", // explicit per delegation discipline
//   graderModel: "sonnet", graderEffort: "medium",
//   stamp: "<session model id + ISO date>",        // passed in: Date.now unavailable in scripts
//   attempt: 1,                                    // optional; increment on re-runs after UNRESOLVED
//   priorRun: "<prior frame/verdict note>"         // optional; required context when attempt > 1
// }
// Cost: workers = probes x reps x 2. Graders = one per pair, plus a second ONLY on forced picks.
// A 8x3 frame is 48 workers + 24-48 graders. Spend added budget on probes, not reps.
export const meta = {
  name: 'ablation-tier3',
  description: 'Two derived arms over approved probes — the text removed (removal mode) or rewritten (substitution mode) — double-query blind-graded against a pre-registered criterion, mechanically tallied',
  phases: [{ title: 'Arms' }, { title: 'Grade' }],
}

// Tolerate args arriving as a JSON-encoded string (documented Workflow-tool footgun).
const A = typeof args === 'string' ? JSON.parse(args) : args
const REQUIRED = ['component', 'criterion', 'steering', 'probes', 'stamp']
const missing = !A ? REQUIRED : REQUIRED.filter(k => !A[k] || (k === 'probes' && !A[k].length))
if (missing.length) {
  throw new Error(`ablation-tier3: missing required args: ${missing.join(', ')}`)
}

// Frame gates — every skill rule expressible as code runs as code, failing loud before any agent spawns.
if (A.probes.length < 3) throw new Error(`ablation-tier3: ${A.probes.length} probes; at least 3 distinct tasks are required`)
const REPS = A.reps ?? 3
if (REPS < 3) throw new Error(`ablation-tier3: reps=${REPS}; >=3 required — within-task variation is what surfaces an inconclusive result`)
const ALPHA = A.alpha ?? 0.05
if (!(ALPHA > 0 && ALPHA <= 0.2)) throw new Error(`ablation-tier3: alpha=${ALPHA} — must be in (0, 0.2]; larger values make the significance machinery meaningless`)
// MIN_PICKS is the POOLED bar (revised 2026-08-15): the strongest possible result is every forced pick
// landing one way, whose exact sign-test p is 0.5^picks, so a design that cannot reach alpha even on
// perfect separation is inconclusive by construction. This used to be enforced as a per-probe REPS floor,
// which was the wrong axis — repeats of one task are correlated (~0.9 measured here), so five repeats
// carry roughly 1.08 independent observations and the floor bought almost nothing while costing 40% of
// the budget. Alpha is reached by pooling forced picks ACROSS tasks; reps only need to expose variation.
const MIN_PICKS = Math.ceil(-Math.log2(ALPHA))
const maxPossiblePicks = A.probes.length * REPS
if (maxPossiblePicks < MIN_PICKS) throw new Error(`ablation-tier3: ${A.probes.length} probes x ${REPS} reps = ${maxPossiblePicks} pairs cannot reach alpha=${ALPHA} even if every pair is a forced pick (best possible p=${(0.5 ** maxPossiblePicks).toFixed(4)}); need at least ${MIN_PICKS} pairs`)
if (!/\d{4}-\d{2}-\d{2}/.test(A.stamp)) throw new Error('ablation-tier3: stamp needs an ISO date — verdicts expire by model and date')

// Upper bound is cost, not an arbitrary task count (revised 2026-08-15). A fixed ceiling of 6, then 20,
// capped what the instrument could detect below the effect sizes worth detecting — which is a defect
// dressed as a safety rail. The real ceiling is the Workflow tool's 1000-agent-per-run cap.
const AGENT_CAP = 1000
const plannedPairs = A.probes.length * REPS
const projectedAgents = plannedPairs * 2 + plannedPairs * 2 // workers both arms + graders, worst case (every pair a forced pick)
if (projectedAgents > AGENT_CAP) throw new Error(`ablation-tier3: ${A.probes.length} probes x ${REPS} reps projects up to ${projectedAgents} agents, above the ${AGENT_CAP}-per-run cap; reduce tasks or split the frame`)
// Planning estimate of the smallest difference this design could detect, so the cost of a null is
// visible BEFORE spending. Assumes repeats correlate at 0.9 (measured locally, on degenerate calibration
// data — treat as directional) and that ~25% of pairs are discordant. Both are recomputed from the
// observed data at the end; this is the number that decides whether the frame is worth launching.
const DEFF = 1 + (REPS - 1) * 0.9
const plannedMDE = Math.round(Math.sqrt(3.0 / (plannedPairs / DEFF)) * 100)
const planning = { plannedPairs, projectedAgentsMax: projectedAgents, designEffect: Math.round(DEFF * 100) / 100, plannedMDEPoints: plannedMDE,
  note: `This design can only detect differences of roughly ${plannedMDE} win-rate points or larger. Published steering effects run -10 to +30 points, so a null from a design above ~30 points says more about the design than the text.` }

// Two modes, one mechanism (substitution support 2026-08-09). Removal asks "is this text needed?";
// substitution asks "is this rewrite better?" by swapping at the SAME single site. Removal is the
// empty-replacement case, so every gate below holds for both: the arms still differ at exactly one place.
const REPLACEMENT = A.replacement ?? ''
const MODE = REPLACEMENT.length ? 'substitution' : 'removal'
if (MODE === 'substitution' && REPLACEMENT === A.component) throw new Error('ablation-tier3: replacement is identical to the component — the arms would not differ')
// Blinding gates cover EVERY version in play: a probe or criterion quoting either one un-blinds the grader.
const VARIANTS = MODE === 'substitution' ? [A.component, REPLACEMENT] : [A.component]
const quiz = A.probes.findIndex(p => VARIANTS.some(v => p.includes(v)))
if (quiz >= 0) throw new Error(`ablation-tier3: probe ${quiz + 1} quotes a version of the text under test verbatim — probes are tasks, not quizzes`)
if (VARIANTS.some(v => A.criterion.includes(v))) throw new Error('ablation-tier3: criterion contains a version of the text under test verbatim — phrase the criterion as an outcome property, not a restatement')

// Arm B is DERIVED, never passed. Exact-once occurrence keeps the change attributable to one site.
// Whitespace is normalized on BOTH arms (fixed 2026-08-09): collapsing only arm B meant steering that
// already contained blank-line runs differed between arms by more than the component.
const occurrences = A.steering.split(A.component).length - 1
if (occurrences === 0) throw new Error('ablation-tier3: component not found verbatim in steering — fix the frame; no fuzzy edits')
if (occurrences > 1) throw new Error(`ablation-tier3: component occurs ${occurrences} times in steering — one component at one site per test`)
const norm = s => s.replace(/\n{3,}/g, '\n\n')
const armAText = norm(A.steering)                                        // control arm — reported as ctrl/"with"
// Function replacer, not a string one (review 2026-08-09): a string replacement interprets $&, $$, $` and $'
// as substitution patterns, so a rewrite containing them would splice in the original component or an
// unbounded run of surrounding steering — silently breaking the one-site invariant. Functions insert literally.
const armBText = norm(A.steering.replace(A.component, () => REPLACEMENT)) // derived arm — reported as abl/"without"
// The invariant that matters is that the texts WORKERS RECEIVE differ, not that the caller's strings differ:
// normalization runs after the splice, so raw-distinct inputs can normalize to identical documents.
if (armAText === armBText) throw new Error('ablation-tier3: the two arms are identical after whitespace normalization — there is nothing to measure')
const armLabels = MODE === 'substitution'
  ? { a: 'with the ORIGINAL', b: 'with the REWRITE', sideA: 'the ORIGINAL', sideB: 'the REWRITE' }
  : { a: 'WITH the text', b: 'WITHOUT it', sideA: 'the WITH side', sideB: 'the WITHOUT side' }
// Direction strings are data, so they name the arms of THIS mode — 'better-with' is meaningless
// when both arms carry text (review 2026-08-09: it was leaking removal vocabulary into substitution runs).
const DIRECTION = MODE === 'substitution'
  ? { a: 'better-original', b: 'better-replacement' }
  : { a: 'better-with', b: 'better-without' }
// Shape confounds a one-site swap still permits: length and line count are not controlled by any gate,
// so they are REPORTED for the reviewer instead of being silently ignored (review 2026-08-09).
const versionShapes = MODE === 'substitution' ? {
  originalChars: A.component.length, replacementChars: REPLACEMENT.length,
  deltaChars: REPLACEMENT.length - A.component.length,
  originalLines: A.component.split('\n').length, replacementLines: REPLACEMENT.split('\n').length,
} : null
const ATTEMPT = A.attempt ?? 1

const OUT_SCHEMA = { type: 'object', properties: { output: { type: 'string', description: 'the work product only — no meta-commentary' } }, required: ['output'] }
const GRADE_SCHEMA = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['X', 'Y', 'both', 'neither'], description: 'which output satisfies the criterion' },
  evidence: { type: 'string', description: 'one sentence citing the decisive difference, or sameness' },
}, required: ['verdict', 'evidence'] }

phase('Arms')
// One work item per probe x rep; both arms of a pair run inside one pipeline stage pass.
const pairs = []
for (let p = 0; p < A.probes.length; p++) for (let r = 0; r < REPS; r++) pairs.push({ p, r })

// Environment isolation (calibration finding 2026-08-07): workers treat probes as tasks in whatever real
// directory they run in — reading it, writing files, executing tests — which contaminates arms through the
// shared filesystem. The output contract below is the ask; worktree isolation is the catch for mutations.
const OUTPUT_CONTRACT = `\n\nOUTPUT CONTRACT: this is a text-only exercise about a hypothetical project — the directory you are running in is NOT that project. Produce your entire answer as text in the output field. Do not read, write, or execute anything; if the task names files, present their paths and contents as text.`
const results = await parallel(pairs.map(({ p, r }) => () => Promise.all([
  agent(`SYSTEM CONTEXT (follow as standing instructions):\n${armAText}\n\nTASK:\n${A.probes[p]}${OUTPUT_CONTRACT}`,
    { label: `ctrl:p${p + 1}r${r + 1}`, phase: 'Arms', schema: OUT_SCHEMA, model: A.workerModel || 'sonnet', effort: A.workerEffort || 'medium', isolation: 'worktree' }),
  agent(`SYSTEM CONTEXT (follow as standing instructions):\n${armBText}\n\nTASK:\n${A.probes[p]}${OUTPUT_CONTRACT}`,
    { label: `abl:p${p + 1}r${r + 1}`, phase: 'Arms', schema: OUT_SCHEMA, model: A.workerModel || 'sonnet', effort: A.workerEffort || 'medium', isolation: 'worktree' }),
]).then(([ctrl, abl]) => ({ p, r, ctrl: ctrl?.output ?? '', abl: abl?.output ?? '' }))))

phase('Grade')
// Field-standard double-query blinding: every pair is graded twice, once per ordering, and a rep counts
// only when the two verdicts agree after unswapping. Position bias produces inconsistency, which drops
// the rep and shrinks n toward the tally's own floor instead of leaking into the verdict.
const gradePrompt = (p, X, Y) => `Two outputs for the same task, labeled X and Y. Judge ONLY this pre-registered criterion — nothing else about quality:\nCRITERION: ${A.criterion}\n\nTASK GIVEN:\n${A.probes[p]}\n\n--- OUTPUT X ---\n${X}\n\n--- OUTPUT Y ---\n${Y}\n\nJudge the two texts exactly as given. Do not consult the filesystem, run code, or verify anything outside this prompt — the texts describe a hypothetical project that does not exist where you are running.`
const unswap = (g, swapped) => g ? {
  ctrl: g.verdict === 'both' || g.verdict === (swapped ? 'Y' : 'X'),
  abl: g.verdict === 'both' || g.verdict === (swapped ? 'X' : 'Y'),
} : null
// A failed/empty worker output is a dropped rep, never a graded pair — grading '' against real
// output manufactures arm deltas from worker noise, not the component (VALIDATION.md, haiku calibration).
// Second grading runs ONLY on forced picks (revised 2026-08-15). A pair where both arms passed, or
// neither did, cannot reveal position bias — there is no ordering for the judge to be biased about —
// yet under unconditional double-grading those ties consumed half the grader budget. Measured rate
// across every archived run: 0 order-flips in 38 forced picks (95% upper bound 7.6%), so the swap is
// kept where it can still catch a regression and dropped where it never could.
const graded = await parallel(results.filter(Boolean).map(({ p, r, ctrl, abl }) => async () => {
  if (!ctrl.trim() || !abl.trim()) return { p, r, status: 'failed' }
  const g1 = await agent(gradePrompt(p, ctrl, abl),
    { label: `grade:p${p + 1}r${r + 1}a`, phase: 'Grade', schema: GRADE_SCHEMA, model: A.graderModel || 'sonnet', effort: A.graderEffort || 'medium' })
  const a = unswap(g1, false)
  if (!a) return { p, r, status: 'graderFailed' }
  // Tie: no ordering to be biased about, so the swapped pass would buy nothing. Counted, not re-graded.
  if (a.ctrl === a.abl) return { p, r, status: 'ok', ctrlSatisfies: a.ctrl, ablSatisfies: a.abl, evidence: g1.evidence, doubleGraded: false, grades: [g1] }
  const g2 = await agent(gradePrompt(p, abl, ctrl),
    { label: `grade:p${p + 1}r${r + 1}b`, phase: 'Grade', schema: GRADE_SCHEMA, model: A.graderModel || 'sonnet', effort: A.graderEffort || 'medium' })
  const b = unswap(g2, true)
  if (!b) return { p, r, status: 'graderFailed' }
  if (a.ctrl !== b.ctrl || a.abl !== b.abl) return { p, r, status: 'inconsistent', grades: [g1, g2] }
  return { p, r, status: 'ok', ctrlSatisfies: a.ctrl, ablSatisfies: a.abl, evidence: g1.evidence, doubleGraded: true, grades: [g1, g2] }
}))

// Full transcript archive (added 2026-08-15). Until now only pass/fail booleans survived a run, so no
// verdict could ever be re-judged — not by a human, not by a different model, not by a later reanalysis.
// Worker prompts are reconstructable from steeringUnderTest + probesUnderTest; the completions were not.
// This is what makes blind human adjudication and cross-model re-judging possible after the fact.
const transcripts = results.filter(Boolean).map(({ p, r, ctrl, abl }) => {
  const g = graded.filter(Boolean).find(x => x.p === p && x.r === r)
  return {
    probe: p + 1, rep: r + 1,
    status: g ? g.status : 'missing',
    armAOutput: ctrl, armBOutput: abl,
    doubleGraded: g ? (g.doubleGraded ?? false) : false,
    grades: g && g.grades ? g.grades.map(x => ({ verdict: x.verdict, evidence: x.evidence })) : [],
  }
})

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

// Mechanical tally — code, not judgment. The reps floor is re-enforced HERE, on surviving rows,
// so dropped grader pairs cannot silently shrink a probe below the floor the entry gate promised.
// Statistics are computed and REPORTED but never decide the verdict — thresholds decide, statistics
// quantify the strength of what they decided (pre-registered alpha travels with the frame).
const perProbe = A.probes.map((probe, p) => {
  const all = graded.filter(Boolean).filter(g => g.p === p)
  const rows = all.filter(g => g.status === 'ok')
  const n = rows.length
  const droppedFailed = all.filter(g => g.status === 'failed').length
  const droppedGraderFailed = all.filter(g => g.status === 'graderFailed').length
  const droppedInconsistent = all.filter(g => g.status === 'inconsistent').length
  const ctrlPass = rows.filter(g => g.ctrlSatisfies).length
  const ablPass = rows.filter(g => g.ablSatisfies).length
  const both = rows.filter(g => g.ctrlSatisfies && g.ablSatisfies).length
  const neither = rows.filter(g => !g.ctrlSatisfies && !g.ablSatisfies).length
  const lowN = n < 3 // surviving reps below the variation floor; alpha is reached by pooling across tasks, not within one
  const degraded = !lowN && ctrlPass >= Math.ceil(2 * n / 3) && (n - ablPass) >= Math.ceil(2 * n / 3)
  const harmful = !lowN && ablPass >= Math.ceil(2 * n / 3) && (n - ctrlPass) >= Math.ceil(2 * n / 3)
  const ctrlOnly = rows.filter(g => g.ctrlSatisfies && !g.ablSatisfies).length
  const ablOnly = rows.filter(g => !g.ctrlSatisfies && g.ablSatisfies).length
  const stats = {
    ctrlOnly, ablOnly,
    pOneSided: signTest(ctrlOnly, ablOnly),
    direction: ctrlOnly > ablOnly ? DIRECTION.a : ablOnly > ctrlOnly ? DIRECTION.b : 'tie',
    ctrlCI95: n ? clopperPearson(ctrlPass, n) : null,
    ablCI95: n ? clopperPearson(ablPass, n) : null,
  }
  // Rep-level data table: every planned rep accounted for, dropped ones included with their reason.
  const byRep = all.slice().sort((a, b) => a.r - b.r)
  const reps = byRep.map(g => ({ rep: g.r + 1, status: g.status, withPassed: g.ctrlSatisfies ?? null, withoutPassed: g.ablSatisfies ?? null }))
  const repLog = byRep.map(g => g.status === 'ok'
    ? `rep ${g.r + 1} — ${armLabels.a}: ${g.ctrlSatisfies ? 'passed' : 'failed'}, ${armLabels.b}: ${g.ablSatisfies ? 'passed' : 'failed'}; judge: ${g.evidence}`
    : `rep ${g.r + 1} — dropped (${g.status === 'failed' ? 'a worker produced no usable output' : g.status === 'graderFailed' ? 'a grader call failed' : 'judges flipped when the labels were swapped'})`)
  return { probe, n, droppedFailed, droppedGraderFailed, droppedInconsistent, ctrlPass, ablPass, both, neither, lowN, degraded, harmful, stats, reps, evidence: repLog }
})
// Pooled sign test: every forced pick is an independent fair coin under the null regardless of
// which probe produced it, so discordant reps pool across probes without further assumptions.
const pooled = {
  ctrlOnly: perProbe.reduce((s, x) => s + x.stats.ctrlOnly, 0),
  ablOnly: perProbe.reduce((s, x) => s + x.stats.ablOnly, 0),
}
pooled.pOneSided = signTest(pooled.ctrlOnly, pooled.ablOnly)
pooled.direction = pooled.ctrlOnly > pooled.ablOnly ? DIRECTION.a : pooled.ablOnly > pooled.ctrlOnly ? DIRECTION.b : 'tie'
// Instrument health — how much of the planned data survived to be scored, and why it was lost.
const pairsPlanned = A.probes.length * REPS
const workerFailures = perProbe.reduce((s, x) => s + x.droppedFailed, 0)
const graderFailures = perProbe.reduce((s, x) => s + x.droppedGraderFailed, 0)
const inconsistentPairs = perProbe.reduce((s, x) => s + x.droppedInconsistent, 0)
const gradedPairs = pairsPlanned - workerFailures - graderFailures
const doubleGradedPairs = graded.filter(Boolean).filter(g => g.doubleGraded).length
const health = {
  pairsPlanned, workerFailures, graderFailures, inconsistentPairs, doubleGradedPairs,
  workerFailureRate: Math.round(workerFailures / pairsPlanned * 1000) / 10,
  graderFailureRate: Math.round(graderFailures / pairsPlanned * 1000) / 10,
  judgeFlipRate: gradedPairs > 0 ? Math.round(inconsistentPairs / gradedPairs * 1000) / 10 : null,
}
// Design-level sensitivity, outcome-independent (review 2026-08-09): conditioning on the observed
// forced-pick count is itself outcome-dependent — a null run mechanically produces few forced picks
// and would report near-zero detectability regardless of the design's real power. Hypothetical: the
// effect converts each usable pair into a clear WITH win with probability f (the rest tie, none go
// the other way — a stated best case). The pooled bar is reached iff wins >= MIN_PICKS, so
// detection chance = P(Binomial(usablePairs, f) >= MIN_PICKS).
const usablePairs = perProbe.reduce((s, x) => s + x.n, 0)
const dForced = pooled.ctrlOnly + pooled.ablOnly
const detectability = [0.2, 0.4, 0.6, 0.8].map(f => ({ convertShare: f, chanceCaught: Math.round(binTailGE(MIN_PICKS, usablePairs, f) * 1000) / 10 }))
// Multiple-looks correction for the best probe: Sidak on min p across probes. Treats probes as
// independent; positive dependence (same workers, same model) makes this conservative — it errs cautious.
const probePs = perProbe.map(x => x.stats.pOneSided).filter(p => p != null)
const familywise = probePs.length ? Math.round((1 - (1 - Math.min(...probePs)) ** A.probes.length) * 10000) / 10000 : null
const reasons = []
if (perProbe.some(x => x.lowN)) reasons.push('a probe fell below the 3-rep variation floor after dropped/inconsistent grader pairs')
if (dForced > 0 && dForced < MIN_PICKS) reasons.push(`only ${dForced} forced picks across all tasks; alpha=${ALPHA} needs at least ${MIN_PICKS} — the run could not have cleared the bar regardless of effect size`)
const anyDegraded = perProbe.some(x => x.degraded)
const anyHarmful = perProbe.some(x => x.harmful)
const allNoDelta = perProbe.every(x => !x.lowN && !x.degraded && !x.harmful && Math.abs(x.ctrlPass - x.ablPass) <= Math.floor(x.n / 3))
// The tally is mode-blind — arm A better / arm B better / no delta. Only the NAMES differ, because
// "needed vs ceremony" and "original vs rewrite" are different questions about the same measurement.
const VERDICTS = MODE === 'substitution'
  ? { armA: 'ORIGINAL-BETTER', armB: 'REPLACEMENT-BETTER', same: 'NO-DIFFERENCE' }
  : { armA: 'LOAD-BEARING', armB: 'HARMFUL', same: 'CEREMONY' }
const verdict = reasons.length ? 'UNRESOLVED' : anyDegraded && !anyHarmful ? VERDICTS.armA : anyHarmful && !anyDegraded ? VERDICTS.armB : allNoDelta ? VERDICTS.same : 'UNRESOLVED'
const ACTIONS = {
  'LOAD-BEARING': 'keep — and consider promoting to a deterministic mechanism that retires the line',
  // A null never authorizes deletion (rule added 2026-08-15). "No difference detected" and "no difference
  // exists" are different claims, and this design only ever supports the first — so the second check is
  // required by the action text itself, not left to the reader's memory of a Bounds section.
  'CEREMONY': 'do NOT delete on this alone — no difference was DETECTED, which is not the same as none existing, and this design can only miss. Deletion needs a second independent check: a human adjudicating a blind sample of the archived pairs, or a deterministic check of the criterion. The text is preserved verbatim below for paste-back either way.',
  'HARMFUL': 'delete or rewrite — the component actively misleads',
  'ORIGINAL-BETTER': 'keep the original wording — the rewrite performed worse on these tasks',
  'REPLACEMENT-BETTER': 'adopt the rewrite — it performed better on these tasks (both versions preserved in the report)',
  'NO-DIFFERENCE': 'no difference was DETECTED between the wordings on these tasks — that is not evidence they are equivalent. Choose on other grounds (brevity, clarity, token cost) if the choice is low-stakes; if it matters, adjudicate a blind sample of the archived pairs by hand.',
}
const recommendedAction = ACTIONS[verdict] ?? `do not act — ${reasons.length ? reasons.join('; ') : 'refine probes or raise reps'}; re-run with fresh frame approval and attempt=${ATTEMPT + 1}`

return {
  verdict,
  stamp: A.stamp,
  attempt: ATTEMPT,
  priorRun: A.priorRun ?? null,
  componentUnderTest: A.component,
  // The frame travels with its results (methods-archival standard): without the steering block the
  // control arm cannot be reconstructed, which is how the 2026-08-07 calibration became unreproducible.
  steeringUnderTest: A.steering,
  probesUnderTest: A.probes,
  mode: MODE,
  replacementText: MODE === 'substitution' ? REPLACEMENT : null,
  armLabels,
  // Uncalibrated until the owner attests otherwise by passing calibratedBy with the VALIDATION.md
  // reference. The note is what makes an uncalibrated run render hedged rather than clean.
  calibrationNote: MODE === 'substitution' && !A.calibratedBy
    ? 'UNCALIBRATED: substitution mode is a distinct measurement claim, and no substitution-mode controls are attested for this run. Its verdicts count only once VALIDATION.md records, for this worker/grader configuration, a positive control (a clear wording beating a deliberately vague rewrite of it), a meaning-preserving placebo (a cosmetic rewrite returning NO-DIFFERENCE), and a length placebo (the same substance at markedly different length, also returning NO-DIFFERENCE — the check for verbosity bias).'
    : null,
  calibratedBy: A.calibratedBy ?? null,
  versionShapes,
  criterion: A.criterion,
  design: { probes: A.probes.length, repsPerArm: REPS, grading: 'single-query, swapped re-grade on forced picks only', alpha: ALPHA, mode: MODE, planning },
  statistics: { alpha: ALPHA, pooled, health, forcedPicks: dForced, minForcedToReachBar: MIN_PICKS, usablePairs, detectability, familywise, note: 'reported evidence strength only — thresholds decide the verdict, statistics quantify it; p-values are one-sided in the direction the data favored (a direction-blind reading doubles them); familywise is Sidak on the smallest per-probe p, conservative under the positive dependence of shared workers; detectability is design-level at fixed hypothetical conversion shares, never at the observed effect' },
  perProbe,
  transcripts,
  unresolvedReasons: reasons,
  recommendedAction,
  // The stamped report is computed, not authored — paste it into the record verbatim.
  report: [
    `Ablation verdict (${MODE} mode): ${verdict}`,
    `Stamp: ${A.stamp} — ${A.probes.length} probes x ${REPS} reps x 2 arms, double-query grading, attempt ${ATTEMPT}${A.priorRun ? ` (prior: ${A.priorRun})` : ''}`,
    `Criterion: ${A.criterion}`,
    ...(MODE === 'substitution' ? [
      A.calibratedBy
        ? `Substitution-mode calibration attested by the frame: ${A.calibratedBy}`
        : 'UNCALIBRATED: no substitution-mode controls attested — this verdict does not yet count (see VALIDATION.md)',
      `Version shapes (uncontrolled confound, reported): original ${versionShapes.originalChars} chars / ${versionShapes.originalLines} lines, rewrite ${versionShapes.replacementChars} chars / ${versionShapes.replacementLines} lines, delta ${versionShapes.deltaChars >= 0 ? '+' : ''}${versionShapes.deltaChars} chars`,
    ] : []),
    `Exact statistics (reported, not verdict-determining; alpha=${ALPHA} pre-registered): pooled forced picks ${pooled.ctrlOnly} favoring ${armLabels.sideA} vs ${pooled.ablOnly} favoring ${armLabels.sideB} — one-sided sign-test p=${fmtP(pooled.pOneSided)}; chance any of ${A.probes.length} tasks shows its standout gap under no effect: p=${fmtP(familywise)}`,
    `Smallest difference this design could detect: about ${plannedMDE} win-rate points (${A.probes.length} tasks x ${REPS} reps; repeats correlate, so ${plannedPairs} pairs carry about ${Math.round(plannedPairs / DEFF)} independent observations). ${verdict === VERDICTS.same ? 'This verdict is a null, so that number is the claim: no difference was detected ABOVE that size.' : ''}`,
    `Instrument health: ${workerFailures}/${pairsPlanned} worker failures (${health.workerFailureRate}%), ${graderFailures} grader failures (${health.graderFailureRate}%), ${inconsistentPairs} judge flip-flops (${health.judgeFlipRate}%), ${doubleGradedPairs} pairs re-graded swapped (forced picks only)`,
    `Design sensitivity (${usablePairs} usable pairs, bar alpha=${ALPHA}, needs >=${MIN_PICKS} clear wins): an effect converting 40% of pairs into clear wins for ${armLabels.sideA} is caught ${detectability[1].chanceCaught}% of the time; 80% -> ${detectability[3].chanceCaught}%. Observed forced picks: ${dForced}${dForced < MIN_PICKS ? ' — below the bar minimum; this run could not have cleared the bar regardless of effect size' : ''}`,
    ...perProbe.map((x, i) => `P${i + 1} (n=${x.n}, dropped ${x.droppedFailed} failed/${x.droppedInconsistent} inconsistent): ${armLabels.sideA} ${x.ctrlPass}/${x.n}, ${armLabels.sideB} ${x.ablPass}/${x.n}, verdict mix both=${x.both} neither=${x.neither} forced=${x.n - x.both - x.neither}, p=${fmtP(x.stats.pOneSided)}${x.lowN ? ' — BELOW REPS FLOOR' : x.degraded ? ` — ${armLabels.sideA} AHEAD` : x.harmful ? ` — ${armLabels.sideB} AHEAD` : ''}`),
    `Action: ${recommendedAction}`,
    MODE === 'substitution' ? 'Original text (verbatim):' : 'Removed text (verbatim, for paste-back):',
    '```',
    A.component,
    '```',
    ...(MODE === 'substitution' ? ['Rewrite tested against it (verbatim):', '```', REPLACEMENT, '```'] : []),
  ].join('\n'),
}
