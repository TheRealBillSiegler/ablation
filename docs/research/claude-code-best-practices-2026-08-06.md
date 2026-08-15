# Reference digest: "Best practices for Claude Code" — Claude Code docs

- **Source:** <https://code.claude.com/docs/en/best-practices>
- **Captured:** 2026-08-06, via WebFetch.

## The delete-test for CLAUDE.md lines (dimension 2)

> "Keep it concise. For each line, ask: *'Would removing this cause Claude to make mistakes?'* If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"

> "**The over-specified CLAUDE.md.** If your CLAUDE.md is too long, Claude ignores half of it because important rules get lost in the noise. > **Fix**: Ruthlessly prune. If Claude already does something correctly without the instruction, delete it or convert it to a hook."

## The verification ladder (dimension 4)

> "Give Claude a check it can run: tests, a build, a screenshot to compare. It's the difference between a session you watch and one you walk away from."

> "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only signal available, and you become the verification loop: every mistake waits for you to notice it."

Ladder, quoted in ascending rigor:
> "**In one prompt**: ask Claude to run the check and iterate in the same message"
> "**Across a session**: set the check as a [`/goal` condition](https://code.claude.com/docs/en/goal). A separate evaluator re-checks it after every turn and Claude keeps working until it holds."
> "**As a deterministic gate**: a [Stop hook](https://code.claude.com/docs/en/hooks#stop) runs your check as a script and blocks the turn from ending until it passes."
> "**By a second opinion**: a [verification subagent](https://code.claude.com/docs/en/sub-agents) or a [dynamic workflow](https://code.claude.com/docs/en/workflows)... has a fresh model try to refute the result, so the agent doing the work isn't the one grading it."

## Advisory vs. deterministic (dimension 5)

> "Use hooks for actions that must happen every time with zero exceptions."

> "[Hooks](https://code.claude.com/docs/en/hooks-guide) run scripts automatically at specific points in Claude's workflow. Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."

---
Re-verify against the live URL before relying on a quote for a durable claim.
