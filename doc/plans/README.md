# Plans (Opus plans, Sonnet implements)

Each roadmap sub-phase that needs more than a one-line fix gets a plan file here, `doc/plans/<phase>-<slug>.md` (e.g. `13.6E-default-scenario.md`). The plan is the **only** context the implementation agent receives, so everything agreed in chat must be written into it.

## Workflow
1. **Research & plan (Opus, main session).** Read the relevant docs and code, check the rule references below, and ask the owner any rules questions. Write the plan using the template, split into small PRs (engine/schema → HUD → scene).
2. **Approve (owner).** Don't implement anything until the owner approves the plan.
3. **Implement (Sonnet `implementer` agent, `.claude/agents/implementer.md`).** One agent per PR section, preferably in an isolated git worktree. It writes tests first, runs all workspaces, updates the docs and checklist, opens a PR to `master`, and does not merge. If a rules question comes up, it stops and reports instead of guessing.
4. **Review (Opus).** Check the diff against the plan and the rules. Send fixes back to the same agent, or patch small issues directly.
5. **Merge to `master`** (squash). Then start the next PR section. **Releases** (`master` → `release`) happen only when the owner explicitly asks in that turn.
6. When a batch (sub-plan) is fully merged, Opus posts that batch's manual checks to the owner (the items its PRs added to `MANUAL_TEST_CHECKLIST.md`). When every section is merged, mark the plan `Status: done` and keep the file as a record.

## Rule references (local only; `assets-src/` is gitignored)
Absolute paths, because worktrees don't contain `assets-src/`:
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Core Rules v3.5.1.pdf`: the core rules (movement, shooting, melee, terrain, jumps/falls, special rules).
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Beginner's Guide v3.5.1.pdf`: expanded explanations, including the **Terrain** chapter (open/impassable/blocking/cover/difficult/dangerous/elevated terrain: climbing up to 3", stepping over ≤1" terrain, split-level coherency, no ending overhanging gaps/terrain) and terrain setup guidelines. Use it where the core rules are silent.
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - HUMAN DEFENSE FORCE V3.5.3.pdf`: a sample army book, used for unit/weapon structure only. We don't ship its data.
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Tournament Guidelines v3.5.0.pdf`: competitive defaults. Relevant to us:
  - **Table & terrain mix** (map editor validation, default scenario / 13.6E): 4'×4' table; scatter pieces roughly 1–3" across, large pieces 4–8" (up to 12"); about a quarter of the table covered; ~3" gaps between large pieces; at least half the pieces block sight, a third give cover, a third are difficult, and at least two are dangerous.
  - **Match format** (scenario / game-over): 300 pts over 4 rounds; a win is 3 TPs; on a draw, a side with nothing left on the table but shaken units (or no units at all) loses, otherwise both get 1 TP; destruction points (points of enemy units destroyed or shaken) break ties.
  - **Line of sight methods**: models see all round, can see through their own unit, and are blocked by other units and solid terrain. There are three alternative methods (top-down height values, hybrid true LoS by size class, volumetric cylinders with 25 mm base ≈ 1" tall). Our engine uses 3D true LoS from a 1.1" eye. Any change toward one of these methods is a rules decision for the owner.
  - **Optional extras** (fortune points, sideboard lists, mixed armies, chess clocks) are out of scope unless the owner adds them to the roadmap.
- `/home/webst/dev-stuff/trench-heresy/assets-src/OPR_TERM_MAPPING.md`: OPR ↔ SkirmishLab term mapping. Update it when traits, rules, units, or weapons are added or renamed.

Clean-room: plans and code describe mechanics in our own words. Never paste rulebook text.

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
- **Docs:** ROADMAP ticks, SYSTEMS/RULES/DATA_MODEL/ASSETS updates
- **Manual checks:** items to add to MANUAL_TEST_CHECKLIST.md
- **Done when:** concrete acceptance criteria

## PR 2: ...

## Open questions
Anything still waiting on the owner (must be empty before status = approved).
```
