# Plans (Fable plans, Sonnet implements)

Each roadmap sub-phase that needs more than a one-line fix gets a plan file here, `doc/plans/<phase>-<slug>.md` (e.g. `13.6E-default-scenario.md`). The plan is the **only** context the implementation agent receives, so everything agreed in chat must be written into it.

## Workflow
1. **Research & plan (Fable, main session).** Read the relevant docs and code, check the rule references below, and ask the owner any rules questions. Write the plan using the template, split into small PRs (engine/schema → HUD → scene).
2. **Approve (owner).** Don't implement anything until the owner approves the plan.
3. **Implement (Sonnet `implementer` agent, `.claude/agents/implementer.md`).** One agent per PR section, preferably in an isolated git worktree. It writes tests first, runs all workspaces, updates the docs and checklist, opens a PR to `master`, and does not merge. If a rules question comes up, it stops and reports instead of guessing.
4. **Review (Fable).** Check the diff against the plan and the rules. Send fixes back to the same agent, or patch small issues directly.
5. **Merge to `master`** (squash). Then start the next PR section. **Releases** (`master` → `release`) happen only when the owner explicitly asks in that turn.
6. When a batch (sub-plan) is fully merged, Fable posts that batch's manual checks to the owner (the items its PRs added to `MANUAL_TEST_CHECKLIST.md`). When every section is merged, mark the plan `Status: done` and keep the file as a record.

## Rule references (local only; `assets-src/` is gitignored)
Absolute paths, because worktrees don't contain `assets-src/`. All are Grimdark Future: Firefight v3.6.0:
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Core Rules v3.6.0.pdf`: the core rules (movement, shooting, melee, terrain, jumps/falls, special rules).
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Beginner's Guide v3.6.0.pdf`: expanded explanations. **The Terrain chapter is the useful part** (open/impassable/blocking/cover/difficult/dangerous/elevated terrain, climbing, stepping over low terrain, split-level coherency, no ending on overhangs) plus terrain setup guidelines. Use it where the core rules are silent.
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Tournament Guidelines v3.6.0.pdf`: competitive defaults. **The terrain mix and the match/points sections are the useful parts** (table size, terrain proportions, game points and rounds, tiebreaks, line of sight methods). Optional extras (fortune points, sideboards, mixed armies, chess clocks) are out of scope unless the owner adds them to the roadmap.
- Army books (sample structure and unit/weapon data for the four armies in 14C-3):
  - `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Human Defense Forcev3.6.0.pdf`
  - `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Alien Hivesv3.6.0.pdf`
  - `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Orc Maraudersv3.6.0.pdf`
  - `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Prime Brothersv3.6.0.pdf`
- Other modes, out of scope unless planned: `GFF - Campaign Rules v3.6.0.pdf`, `GFF - Horde Mode v3.6.0.pdf`, `GFF - Solo & Co-Op Rules v3.6.0.pdf` (same folder).
- `/home/webst/dev-stuff/trench-heresy/assets-src/OPR_TERM_MAPPING.md`: historical (from before the move to OPR's own names). Not updated any more.

Use OPR's names and match v3.6 mechanics, but plans and code describe them in our own words. Never paste rulebook or army book text, use logos or art, or use Patreon-only content.

## Template

```markdown
# <Phase id>: <title>
Status: draft | approved | in progress | done
Roadmap: doc/ROADMAP.md § <sub-phase>

## Goal
One paragraph: what the player/owner gets.

## Decisions (agreed)
Numbered, each stated as a fact the implementer must not revisit
(rules interpretations, dimensions, thresholds, UX choices). Quote the owner's choice where useful.

## Out of scope
What not to touch (deferred visuals, unrelated bugs, future phases).

## Background
Relevant code paths (`file:line` / function names), existing behaviour, known gotchas.

## PR 1: <title>  (branch: `<phase>-<slug>-1`)
- **Layer:** shared engine | client HUD | renderer | docs
- **Files:** expected files to change
- **Tests first:** the failing tests to write (behaviour + boundaries)
- **Implementation steps:** short, ordered
- **Docs:** ROADMAP ticks, SYSTEMS/RULES/DATA_MODEL/ASSETS updates, UI inventory entries (`doc/ux/inventory/`) for any screen or prompt the PR changes
- **Manual checks:** items to add to MANUAL_TEST_CHECKLIST.md
- **Done when:** concrete acceptance criteria

## PR 2: ...

## Open questions
Anything still waiting on the owner (must be empty before status = approved).
```
