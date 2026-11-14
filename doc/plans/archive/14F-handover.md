# 14F handover: carrying on with Gemini while Claude is unavailable
Status: done (PR 2 #409, post-PR 2 profile #411, and PR 3 #412 merged)
Written 2026-11-14 by Claude for the owner. Plan: [14F-performance.md](../14F-performance.md). General Gemini rules: [GEMINI_HANDOVER.md](../GEMINI_HANDOVER.md).

## Where things stand
- The 14F plan is approved and on `master` (#406).
- **PR 1 is merged** (#407, `5195898`, done by Hydrogen): 95 golden snapshot cases in `shared/tests/engine/navGolden.test.ts` and a benchmark in `shared/tests/engine/navBench.test.ts`. The baseline is in the plan's "PR 1 results": `findNavPath` p95 336 ms (target 10 ms), and a 6 vs 6 squad charge check takes 25 s (target 300 ms).
- **PR 2 is next** (the A* speed-ups) and goes to **Argon**. The prompt is below.
- PR 3 and anything after it **has no detailed plan yet**. Don't hand it to Gemini as an implementation job; see "After PR 2" below.
- Findings F1-F4 from PR 1 are in the plan. They are for a later bugfix batch, not for Gemini to fix now. F3 is a rules question for the owner.

## Job 1: PR 2 for Argon
Paste this into Argon:

```text
You are implementing one PR for SkirmishLab, a TypeScript + Three.js tabletop skirmish simulator in this repository.

Your task: PR section "PR 2: A* speed-ups with identical results" of the plan doc/plans/14F-performance.md. Use the branch name the plan gives (14F-perf-2).

Before writing any code, read in full:
1. AGENTS.md: the project rules. They apply to you even though the file is not called GEMINI.md.
2. .claude/agents/implementer.md: your working rules. Follow them exactly, with three differences: you are not a Claude agent; ignore anything about Sonnet, Fable or subagents; and your final report goes to the project owner, who passes it on to the reviewer.
3. The plan file, including "PR 1 results". Its "Decisions (agreed)" are fixed: do not reopen or change them.
4. The code the plan's Background section names, especially findNavPath in shared/src/engine/spatial.ts and shared/tests/engine/navGolden.test.ts.

Hard rules (stop and report rather than break any of them):
- Do only the three steps of PR 2, in the plan's order (P3, then P2, then P1), and run shared/tests/engine/navGolden.test.ts after each step. It takes about two minutes.
- The golden snapshots are the behaviour test. Never run UPDATE_NAV_GOLDEN=1 and never edit anything in shared/tests/fixtures/nav-golden/. If any snapshot case fails after a step, stop: report the step, the failing case ids and the old vs new paths. Do not try to "fix" the order of ties.
- No changes to movement costs, waypoints, findMoveBlocker, classifySegment or closestApproach. Only the A* section of findNavPath changes, plus an optional shared/src/engine/minHeap.ts with its own tests.
- Run the benchmark (NAV_BENCH=1) on master before your first change and again at the end, and put both sets of numbers in the PR body and your report.
- Follow the standard rules in doc/plans/GEMINI_HANDOVER.md (worktree, tests, git safety, commit trailer, PR body, CI, report).

When you are done, reply with a short report:
- PR URL, branch, CI status, test counts per workspace;
- benchmark before and after (findNavPath mean / p95, closestApproach, each squad charge case);
- which steps you completed, and any that stopped on a snapshot change;
- any deviations from the plan, and why; anything out of scope you noticed.
```

If Argon stops on a snapshot change, that is the plan working, not a failure. Keep the PR open (or the branch) and leave the decision for Claude.

## Reviewing PR 2 without Claude
The safest choice is to **leave PR 2 open until Claude is back**: the host uses this code for squad charge and pile-in rulings, and the plan says Claude reviews it line by line. If you want to merge it yourself, these are the minimum checks. Merge only if every one passes.

**1. Only the expected files changed.** Run `gh pr diff <n> --name-only`. The list should be no more than:
- `shared/src/engine/spatial.ts`
- `shared/src/engine/minHeap.ts` and `shared/tests/engine/minHeap.test.ts` (optional)
- `shared/tests/engine/closestApproach.test.ts` (timing guards only)
- `doc/SYSTEMS.md`, `doc/ROADMAP.md`, `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`

Anything else, and especially anything in `shared/tests/fixtures/nav-golden/` or `shared/tests/fixtures/navGoldenCases.ts`, means don't merge.

**2. The snapshots weren't touched.** `gh pr diff <n> --name-only | grep -E 'nav-golden|navGoldenCases'` must print nothing.

**3. CI is green** on the PR (`gh pr checks <n>`), and the golden suite ran in it (the shared test count includes `navGolden`).

**4. The code does what the plan says.** In the `findNavPath` diff in `spatial.ts`:
- The "Try direct link to target" block is gone, and in the neighbour loop the target node skips **both** the `d > 16.0` cap and the drop-spot filter. (If only the 16" cap is skipped, results can change from drop spots; the snapshots should catch it, but check.)
- Before the expensive checks there is a lower-bound skip: `0` for a ladder step (`isLadderStepSegment`), otherwise `distanceHorizontal(current.pos, neighbor.pos)`, and the test is `current.g + lb >= neighbor.g` (`>=`, not `>`).
- The open array is replaced by a heap ordered by `f`, then by a push counter (`seq`). Popped entries are skipped when their node is already closed or their `f` no longer matches the node's. `openSet.sort`, `openSet.shift` and `openSet.includes` are gone.
- Nothing else in `findNavPath` changed: waypoint generation, string-pulling, ladder straightening and clamping are untouched.

**5. It's faster.** The PR body has before and after benchmark numbers, and every line is lower. Big gains aren't expected yet: the plan says PR 2 alone won't reach the targets.

**6. Manual check.** Do the item PR 2 adds to the manual checklist: hover-preview paths on the Standard Battlefield look the same, and a squad charge round a wall is accepted or rejected as before.

After merging: `git -C /home/webst/dev-stuff/trench-heresy pull --ff-only --autostash`, delete the branch, and update the plan's Status line ("PR 2 done (Gemini, #N)"). Claude will re-check the merged diff when it's back.

## After PR 2
PR 3 (reusing the terrain part of the graph) and the likely extra PR that cuts how many searches `closestApproach` runs both change risky code and **need a plan from Claude first**. Don't start them as implementation jobs.

What Argon can usefully do in the meantime is a **read-only profiling report**, which the planning will start from. It changes no code. Paste this after PR 2 is merged:

```text
You are doing a read-only investigation for SkirmishLab, a TypeScript + Three.js tabletop skirmish simulator in this repository. You change no source code and open no code PR.

Read AGENTS.md, doc/plans/GEMINI_HANDOVER.md (standard rules), and doc/plans/14F-performance.md (including "PR 1 results").

Task: find out where the time goes in findNavPath and closestApproach on the Standard Battlefield after PR 2, so the next 14F PRs can be planned.
1. Work in your own worktree from origin/master (standard rules).
2. Profile the navBench cases (NAV_BENCH=1), for example with `node --cpu-prof` on a small script under your worktree's tmp, or by temporarily wrapping functions with timers in an uncommitted local change. Never commit instrumentation.
3. Report, for findNavPath: how many waypoints and how many edge checks a typical search makes, and the share of time in findMoveBlocker, isSegmentSurfaceConstrained, classifySegment, waypoint generation, string-pulling and the heap. For closestApproach: how many findNavPath calls each squad charge case makes, and how many of them take the straight-line fast path.
4. Write the results to doc/reviews/14F-profile.md (numbers and short observations in your own words; no fixes, no code). Open a docs-only PR with just that file, following the standard rules, and do not merge it.
5. Ideas for speed-ups go in a separate "Ideas (not decided)" section at the end of that file. Don't implement any of them.

Report: the PR URL and the headline numbers.
```

## When Claude is back
Tell Claude: "Read doc/plans/14F-handover.md and catch up." Claude should then:
1. Re-check PR 2 (merged or open) against the plan.
2. Read `doc/reviews/14F-profile.md` if it exists, and plan PR 3 and the `closestApproach` workload PR in `14F-performance.md`.
3. Ask the owner the F3 rules question (should height count in "as close as possible"?), and put F1-F4 into a bugfix batch.
