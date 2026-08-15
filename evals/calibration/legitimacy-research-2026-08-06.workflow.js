export const meta = {
  name: 'ablation-legitimacy-research',
  description: 'Source-grounded research validation of the ablation skill: method provenance, experimental design, LLM-judge validity, drift evidence, prior art, adversarial critique',
  phases: [
    { title: 'Sweep', detail: 'five researchers, one methodological pillar each, live sources only' },
    { title: 'Critique', detail: 'adversarial reviewer rules kills vs bounds', model: 'opus' },
  ],
}

const RES_SCHEMA = { type: 'object', properties: {
  pillar: { type: 'string' },
  verdict: { type: 'string', enum: ['SUPPORTED', 'MIXED', 'UNSUPPORTED'], description: 'is the skill legitimate on this pillar' },
  findings: { type: 'array', items: { type: 'object', properties: {
    claim: { type: 'string', description: 'the skill claim or design element examined' },
    support: { type: 'string', enum: ['supports', 'contradicts', 'bounds', 'prior-art'] },
    source: { type: 'string', description: 'full URL of the page actually fetched' },
    quote: { type: 'string', description: 'verbatim quote from the fetched page, <=50 words' },
    note: { type: 'string' },
  }, required: ['claim', 'support', 'source', 'quote'] } },
  gaps: { type: 'string', description: 'what could not be verified this session' },
}, required: ['pillar', 'verdict', 'findings'] }

const CRIT_SCHEMA = { type: 'object', properties: {
  attacks: { type: 'array', items: { type: 'object', properties: {
    critique: { type: 'string' },
    ruling: { type: 'string', enum: ['KILLS', 'BOUNDS', 'FAILS'], description: 'KILLS = method unsound at core; BOUNDS = valid only within limits the skill must state; FAILS = attack does not hold' },
    rationale: { type: 'string', description: 'grounded in the findings evidence or a fetched source' },
    requiredEdit: { type: 'string', description: 'if BOUNDS: the limit the skill text must state' },
  }, required: ['critique', 'ruling', 'rationale'] } },
  overall: { type: 'string', enum: ['LEGITIMATE', 'LEGITIMATE-WITH-BOUNDS', 'ILLEGITIMATE'] },
  rationale: { type: 'string' },
}, required: ['attacks', 'overall', 'rationale'] }

const PRE = `You are validating the methodological legitimacy of a locally-authored Claude Code skill named "ablation". First Read both files in full:
- C:/Users/billy/.claude/skills/ablation/SKILL.md (the skill)
- C:/Users/billy/.claude/skills/ablation/scripts/tier3-arms.workflow.js (its automation template)
Then research your pillar on the live web: load web tools via ToolSearch (query "select:WebSearch,WebFetch"), search, and FETCH pages before citing them. Hard rules: every quote verbatim from a page fetched this session, never recalled from training; full URLs; prefer primary sources (papers, official vendor docs) over blog commentary; if a point cannot be verified, report it under gaps instead of asserting it. Your structured output is raw data for a synthesis step, not a human-facing message.`

const PILLARS = [
  { key: 'ml-ablation', prompt: `${PRE}

PILLAR: Ablation studies in machine learning. (1) What does "ablation study" mean in ML practice, and does this skill's method — remove a component, run matched comparisons, observe the behavioral delta — faithfully match that meaning? (2) Are ablations an expected rigor norm (e.g. conference reviewer/checklist requirements)? (3) What published critiques exist of ablation practice — what makes an ablation informative vs misleading — and do they apply to this design? (4) Is applying ablation to PROMPT/steering components rather than model components an established or emerging usage — find concrete examples of prompt-ablation in papers or engineering practice.` },
  { key: 'experiment-design', prompt: `${PRE}

PILLAR: Experimental-design standards. The template uses: a pre-registered criterion, control vs treatment arms, >=3 repetitions per probe per arm, blinded grading, pre-defined 2/3-threshold verdict boundaries, and UNRESOLVED as an allowed outcome. (1) Which parts match accepted standards — pre-registration, blinding, counterbalancing? Cite methods sources. (2) What do methods sources say about n=3 samples and the strength of conclusions it can support? (3) The verdict rule fires LOAD-BEARING if ANY probe shows the delta — does published multiple-comparisons guidance say this inflates false positives, and by what logic? (4) Are fixed mechanical decision thresholds without significance testing defensible for small-n SCREENING decisions — what distinction do sources draw between screening and confirmatory designs?` },
  { key: 'llm-judge', prompt: `${PRE}

PILLAR: LLM-as-judge validity. The template grades via paired outputs under neutral X/Y labels, arm identity withheld, position counterbalanced by deterministic alternation, a single pre-registered criterion, and an enum verdict (X/Y/both/neither). (1) What does the LLM-as-judge literature (MT-Bench/Chatbot Arena judging paper, successors, vendor eval guidance) establish about position bias, verbosity bias, and self-preference bias in pairwise judging? (2) Is position alternation/swapping an accepted mitigation, and which biases survive it? (3) Does judging one pre-registered criterion rather than overall quality match recommended rubric-judge practice? (4) Grader and workers from the same model family — what does the literature say about self-preference bias, and does it bound this design?` },
  { key: 'drift', prompt: `${PRE}

PILLAR: Prompt sensitivity and model-version drift. The skill claims verdicts "expire on model upgrade" and that "steering accretes; models improve; yesterday's load-bearing line is today's ceremony". (1) What published evidence shows the same prompt behaving differently across model versions or upgrades of the same product (e.g. GPT behavior-drift studies, instruction-following changes)? (2) Any studies of prompt brittleness/sensitivity that bear on whether small steering components have measurable effects at all? (3) Does any vendor documentation advise re-testing prompts when the underlying model changes? (4) Is steering accretion/staleness documented as a real failure mode — context bloat, instruction dilution, long-context degradation?` },
  { key: 'prior-art', prompt: `${PRE}

PILLAR: Vendor guidance and prior art. (1) Fetch https://code.claude.com/docs/en/best-practices and verify whether a delete-test for CLAUDE.md/steering lines appears — quote it exactly if so. (2) Does other Anthropic guidance (context engineering, prompt engineering, evals) support remove-and-observe maintenance of steering text? (3) What existing tools/frameworks already do systematic prompt-component or prompt-variant testing — promptfoo, DSPy, OpenAI Evals, A/B prompt-testing platforms — and is this skill convergent with them or ignorant of something superior they do? (4) Any practitioner writing on pruning/auditing agent instructions or CLAUDE.md bloat specifically.` },
]

phase('Sweep')
// Barrier justified: the critic must see ALL pillar findings together.
const findings = (await parallel(PILLARS.map(p => () =>
  agent(p.prompt, { label: `research:${p.key}`, phase: 'Sweep', schema: RES_SCHEMA, model: 'sonnet', effort: 'high' })
))).filter(Boolean)
log(`Sweep complete: ${findings.length}/5 pillars returned`)

phase('Critique')
const critique = await agent(`You are an adversarial methodology reviewer. Read both files in full:
- C:/Users/billy/.claude/skills/ablation/SKILL.md
- C:/Users/billy/.claude/skills/ablation/scripts/tier3-arms.workflow.js

Below are source-grounded research findings from five pillars. Make the STRONGEST case that this skill is NOT a legitimate method: misappropriated terminology, statistically invalid inference, judge-bias vulnerabilities, unfalsifiable claims, reinvention that ignores superior prior art. Then rule each attack: KILLS (method unsound at its core), BOUNDS (valid only within limits the skill text must state — name the required edit), or FAILS (the attack does not survive the evidence). Ground rulings in the findings' quoted evidence; you may load web tools via ToolSearch (query "select:WebSearch,WebFetch") to check a decisive point. Do not soften; do not pad. Your structured output is raw data for synthesis.

FINDINGS:
${JSON.stringify(findings)}`, { label: 'adversarial-critic', phase: 'Critique', schema: CRIT_SCHEMA, model: 'opus', effort: 'high' })

return { findings, critique }
