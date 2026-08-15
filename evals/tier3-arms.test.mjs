// Test for tier3-arms.workflow.js — exercises every gate, the tally, the verdict rules and the
// report, with stubbed workers and graders. Spawns nothing and costs nothing.
//
//   node evals/ablation/tier3-arms.test.mjs
//
// Run it after ANY edit to the workflow script. `node --check` only parses; it will not catch a
// reference to a deleted identifier, which is exactly how the MIN_REPS rename nearly shipped broken.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// The only code evaluated here is the sibling workflow script — the file under test, read from this
// script's own directory. It is never user input, and nothing from a test frame reaches the evaluated
// source. Frames are passed as DATA through the sandbox's `args`, never interpolated into the source.
const SRC = new URL('../../plugins/ablation/skills/ablation/scripts/tier3-arms.workflow.js', import.meta.url)
const raw = readFileSync(SRC, 'utf8').replace('export const meta', 'const meta')

// The script expects the Workflow tool's globals and ends in a top-level return, so it runs inside a
// sandbox with those globals stubbed. Worker and grader calls are recorded rather than spawned.
async function run(args, agentImpl) {
  const calls = []
  const sandbox = {
    args,
    agent: async (prompt, opts) => { calls.push({ label: opts.label, prompt }); return agentImpl(prompt, opts) },
    parallel: thunks => Promise.all(thunks.map(t => t().catch(() => null))),
    phase: () => {}, log: () => {},
    Math, JSON, Promise, Error, String, Number, Array, Object, Boolean, RegExp, isNaN, parseInt, parseFloat,
  }
  return { result: await runInNewContext(`(async () => {\n${raw}\n})()`, sandbox), calls }
}

// Control arm satisfies the criterion; ablated arm does not. Graders read whichever text is first.
const controlWins = (prompt, opts) => {
  if (opts.label.startsWith('grade')) {
    const x = prompt.split('--- OUTPUT X ---')[1].split('--- OUTPUT Y ---')[0]
    return { verdict: x.includes('MARKER') ? 'X' : 'Y', evidence: 'stub' }
  }
  return { output: prompt.includes('LINT-RULE') ? 'MARKER present' : 'plain output' }
}
// Both arms indistinguishable — the null path.
const noDelta = (prompt, opts) => opts.label.startsWith('grade')
  ? { verdict: 'both', evidence: 'stub' } : { output: 'MARKER present' }

const FRAME = {
  component: 'Always run the linter before committing. LINT-RULE',
  criterion: 'The response mentions running a linter before committing',
  steering: 'House rules.\n\nAlways run the linter before committing. LINT-RULE\n\nBe concise.',
  probes: ['Edit the parser and commit.', 'Rename a helper and commit.', 'Add a flag and commit.',
           'Fix an off-by-one and commit.', 'Extract a function and commit.', 'Update a docstring and commit.'],
  reps: 3, alpha: 0.05, stamp: 'claude-sonnet-5 2026-08-15',
}
const PAIRS = FRAME.probes.length * FRAME.reps

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}
const throws = async (name, args, needle) => {
  try { await run(args, controlWins); check(name, false, 'expected a throw, got none') }
  catch (e) { check(name, String(e.message).includes(needle), `message was: ${e.message}`) }
}

console.log('\n--- Gates: every one must throw before a worker or grader is spawned ---')
await throws('fewer than 3 tasks', { ...FRAME, probes: ['a', 'b'] }, 'at least 3 distinct tasks')
await throws('frame exceeds the run agent cap', { ...FRAME, probes: Array(200).fill('x') }, 'agent')
await throws('reps below the variation floor', { ...FRAME, reps: 2 }, 'reps=2')
await throws('design cannot reach alpha at any effect size', { ...FRAME, probes: ['a', 'b', 'c'], alpha: 0.001 }, 'cannot reach alpha')
await throws('component absent from steering', { ...FRAME, component: 'not present' }, 'not found verbatim')
await throws('component occurs more than once', { ...FRAME, steering: FRAME.steering + '\n' + FRAME.component }, 'occurs 2 times')
await throws('a probe quotes the component', { ...FRAME, probes: [FRAME.component, 'b', 'c'] }, 'quizzes')
await throws('criterion restates the component', { ...FRAME, criterion: FRAME.component }, 'restatement')
await throws('replacement identical to component', { ...FRAME, replacement: FRAME.component }, 'identical to the component')
await throws('stamp without an ISO date', { ...FRAME, stamp: 'no-date' }, 'ISO date')
await throws('missing a required arg', { ...FRAME, criterion: '' }, 'missing required args')

console.log('\n--- Arm derivation: $-patterns in a rewrite must insert literally ---')
{
  const { result, calls } = await run({ ...FRAME, replacement: 'Use $& and $` literally.' }, controlWins)
  const armB = calls.find(c => c.label.startsWith('abl')).prompt
  check('rewrite reaches arm B verbatim', armB.includes('Use $& and $` literally.'))
  check('no substitution pattern spliced the original back in', !armB.includes('LINT-RULE'))
  check('rewrite preserved in the result', result.replacementText.includes('$&'))
}

console.log('\n--- Grading: the swapped re-grade runs only where it can reveal position bias ---')
{
  const forced = await run(FRAME, controlWins)
  const forcedGrades = forced.calls.filter(c => c.label.startsWith('grade')).length
  check('forced picks are graded in both orders', forcedGrades === PAIRS * 2, `${forcedGrades} grader calls`)

  const tied = await run(FRAME, noDelta)
  const tiedGrades = tied.calls.filter(c => c.label.startsWith('grade')).length
  check('ties are graded once', tiedGrades === PAIRS, `${tiedGrades} grader calls`)
  check('ties report no swapped re-grades', tied.result.statistics.health.doubleGradedPairs === 0)
  check('the saving is real', tiedGrades < forcedGrades)
}

console.log('\n--- Tally, planning figures and the transcript archive ---')
{
  const { result } = await run(FRAME, controlWins)
  check('control winning everywhere yields LOAD-BEARING', result.verdict === 'LOAD-BEARING', `got ${result.verdict}`)
  check('every pair archived', result.transcripts.length === PAIRS, `${result.transcripts.length} transcripts`)
  check('archive carries raw completions', result.transcripts.every(t => t.armAOutput && t.armBOutput))
  check('archive carries grader verdicts', result.transcripts.every(t => t.grades.length >= 1))
  check('pooled forced picks tallied', result.statistics.pooled.ctrlOnly === PAIRS)
  check('pooled bar resolves', Number.isFinite(result.statistics.minForcedToReachBar))
  check('detectability computed', result.statistics.detectability.every(d => Number.isFinite(d.chanceCaught)))
  check('planning figures present', Number.isFinite(result.design.planning.plannedMDEPoints))
  check('report free of undefined and NaN', !/undefined|NaN/.test(result.report),
    result.report.split('\n').find(l => /undefined|NaN/.test(l)) || '')
}

console.log('\n--- The null path must refuse to authorize deletion ---')
{
  const { result } = await run(FRAME, noDelta)
  check('indistinguishable arms yield CEREMONY', result.verdict === 'CEREMONY', `got ${result.verdict}`)
  check('action forbids deleting on the null alone', /do NOT delete/i.test(result.recommendedAction), result.recommendedAction)
  check('report states the smallest detectable difference', /Smallest difference this design could detect/.test(result.report))
  check('component preserved verbatim for paste-back', result.report.includes(FRAME.component))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
