# Working without Claude: handover to Gemini
Written 2026-11-14 by Claude, for the owner and for Gemini (Argon, Hydrogen). Use it whenever Claude is unavailable (out of usage, weekend). Day-to-day Gemini rules are in [GEMINI_HANDOVER.md](GEMINI_HANDOVER.md); the 14F details are in [14F-handover.md](14F-handover.md). When Claude is back, tell it: "Read doc/plans/HANDOVER.md and catch up."

## Who does what while Claude is away
| Role | Normally | While Claude is away |
|---|---|---|
| Plan | Claude writes `doc/plans/<id>.md`, owner approves | **Argon** drafts the plan (planning prompt below), **owner** answers its questions and approves |
| Implement | Sonnet `implementer` agent | **Argon** for engine-adjacent or tricky work, **Hydrogen** for small client, docs and test-only jobs |
| Review & merge | Claude | **Owner**, using the merge policy below |
| Release | Owner's command only | Unchanged: owner only (see "Releasing") |

Argon is the stronger model; give it anything that touches `shared/src/engine/`, networking or more than a few files.

## Merge policy (the important part)
Gemini never merges. The owner merges, but only the low-risk kinds of PR. Everything else stays **open for Claude to review** when it's back.

**The owner may merge** (after CI is green and the PR's manual checks pass):
- docs-only PRs;
- tests-only PRs (no file under any `src/` changed);
- client-only PRs (`client/src/` only) with no rule logic, after playing the change in two browsers;
- 14F PR 2, only if every check in [14F-handover.md](14F-handover.md) passes.

**Leave open for Claude:**
- anything that changes `shared/src/engine/` rules or host validation (except 14F PR 2 above), the P2P protocol, `GameState` or the signaling server;
- any PR whose body lists a deviation from its plan, a rules doubt or a snapshot change.

Open PRs pile up conflicts, so **don't start a second job that touches the same files as a PR still open**. Pick a job from a different area instead (the queue below says which files each one touches).

After any merge: `git -C /home/webst/dev-stuff/trench-heresy pull --ff-only --autostash`, delete the branch (`git push origin --delete <branch>`), remove Gemini's worktree (`git worktree remove .claude/worktrees/<branch>`; first check it has no uncommitted work), and update the plan's Status line.

## House rules Gemini wouldn't otherwise know
These come from the owner and live in Claude's memory, not in the repo. Every Gemini job follows them.
1. **Rules changes need the owner.** Never change a game rule without the owner's explicit answer, recorded in the plan. On a rules doubt, stop and ask (planning) or stop and report (implementing). Check rule wording in the v3.6 PDFs in `assets-src/` (absolute paths in [README.md](README.md)); never paste their text.
2. **Plan first, small PRs.** Anything bigger than a one-line fix gets a plan in `doc/plans/` with small PR sections (engine and schema, then HUD, then scene). Manual checks go into the one checklist, `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`, never a new file.
3. **Manual checks come with fixtures.** A PR that adds manual checks also ships what's needed to try them: a built-in test map and/or a dev-mode TEST army (see `test-hazard-army`, `jump-range` and friends in `shared/src/data/`).
4. **Reaction docks get Auto + Confirm only.** No "let the host decide" buttons; when a prompt times out, the host's Auto is the fallback.
5. **Shared checkout.** The main checkout (`/home/webst/dev-stuff/trench-heresy`) is shared. Gemini always works in its own worktree (`.claude/worktrees/<branch>`), never commits there with `-a`, and never switches its branch.
6. **Releases** only on the owner's explicit command (see "Releasing").

## Planning prompt (Argon)
For any queue item marked "needs a plan". Paste, filling in the item:

```text
You are planning one piece of work for SkirmishLab, a TypeScript + Three.js tabletop skirmish simulator in this repository. You write a plan only; you change no code.

Read first: AGENTS.md, doc/plans/HANDOVER.md (especially "House rules"), doc/plans/README.md (workflow and the plan template), doc/plans/GEMINI_HANDOVER.md, and the docs that apply (doc/SYSTEMS.md, doc/RULES_SPECIFICATION.md, doc/NETWORKING.md, doc/DATA_MODEL.md, doc/ARCHITECTURE.md).

The work: <queue item name and its description from doc/plans/HANDOVER.md>.

1. Work in your own worktree from origin/master: git fetch && git worktree add .claude/worktrees/plan-<id> origin/master -b plan-<id>.
2. Research the code paths involved and confirm any findings it fixes (cite file:line). If a finding can't be confirmed from the code, say so in the plan.
3. Write doc/plans/<id>.md with the template from doc/plans/README.md: goal, decisions, out of scope, background with file:line references, small PR sections (each with files, tests first, steps, docs, manual checks with their fixtures, done-when).
4. Anything that is a rules interpretation or a product choice goes under "Open questions", with options and your recommendation. Do not decide rules yourself. Never paste text from the rule PDFs.
5. Open a docs-only PR with just the plan (standard rules in doc/plans/GEMINI_HANDOVER.md; commits end with Co-Authored-By: Gemini <noreply@google.com>). Do not merge it.

Report: the PR URL and the open questions, numbered, so the owner can answer them in one message.
```

The owner then answers the questions (reply on the PR or in Gemini: "add these answers to the plan's Decisions and set Status: approved"), merges the plan PR (docs only), and hands each PR section to Argon or Hydrogen with the implementation prompt in [GEMINI_HANDOVER.md](GEMINI_HANDOVER.md#the-prompt).

## The queue, in the agreed order
Status as of 2026-11-14 (`fba67a3`). Bugfix batch 2 findings (G-xx) are described in [doc/reviews/14E-gemini-findings.md](../reviews/14E-gemini-findings.md); each fix must first reproduce its finding with a failing test, and drops it if it can't.

| # | Item | Area (files) | Ready? | Who | Owner may merge? |
|---|---|---|---|---|---|
| 1 | **14F PR 2**: A* speed-ups | `shared/src/engine/spatial.ts` | Plan approved; prompt in 14F-handover | Argon | Only via the 14F-handover checklist |
| 2 | **14F profile** (read-only) | `doc/reviews/` | Prompt in 14F-handover; after #1 | Argon or Hydrogen | Yes (docs) |
| 3 | **2D Resume as host** (`bugfix-batch-2.md` PR 5): confirm G-09 against current code; keep active session / rejoin token in `sessionStorage` (`SessionStore`), initiate SDP offer on host resume, and fix G-24 reconnect races | `client/src/storage/`, `client/src/network/`, `client/src/ui/Lobby.ts` | Planned in `bugfix-batch-2.md` PR 5 (awaiting approval) | Argon | Client-only part yes, after a two-browser test |
| 4 | **UI inventory re-take**: lobby "?", waking-up lobby, how-to-play modal, header mute, distance indicators, hazard highlight `47-hazard-highlight`, `s9-07` | `doc/ux/inventory/`, `tools/ux-inventory/` | Ready (tooling in `tools/ux-inventory/README.md`) | Hydrogen (text in `catalog.js`), owner takes screenshots if Gemini can't | Yes (docs) |
| 5 | *(Merged into item #3 / `bugfix-batch-2.md` PR 5)* **G-24 client reconnect races** | `client/src/network/`, `client/src/ui/Lobby.ts` | Planned in `bugfix-batch-2.md` PR 5 | Argon | Yes, after a two-browser test (client-only) |
| 6 | **14H docs sync**: stale default-scenario table in `doc/ASSETS.md`, old doorway opening in `doc/SYSTEMS.md`, record the 13.6E follow-ups, close `doc/plans/bugfix-playtest-batch-1.md` | `doc/` | Ready enough for a docs job | Hydrogen | Yes (docs) |
| 7 | **2C Host validation & 14F pathfinder fixes** (`bugfix-batch-2.md` PRs 1–3, no rule changes): 14F `F1`/`F2`/`F4` (`PR 1`), `G-07`/`G-08`/`G-17`/`G-20` (`PR 2`), `G-12`/`G-14`/`G-16`/`G-19`/`G-21`/`G-31` (`PR 3`) | `shared/src/engine/`, `shared/src/data/` | Planned in `bugfix-batch-2.md` PRs 1–3 (awaiting approval) | Argon | No, leave open for Claude |
| 8 | **2F Rules fixes & G-35 docs** (`bugfix-batch-2.md` PR 4, after PRs 1–3): owner's answers 1–4 at the end of 14E findings file, with `G-13`, `G-18`, and `G-35` | `shared/src/engine/`, `doc/` | Planned in `bugfix-batch-2.md` PR 4 (rules already answered; awaiting approval) | Argon | No |
| 9 | *(Merged into item #8 / `bugfix-batch-2.md` PR 4)* **G-35** stale rules docs | `doc/` | Planned in `bugfix-batch-2.md` PR 4 | Argon / Hydrogen | Yes (docs) |
| 10 | **Each player picks their own army** (ROADMAP 14G) | protocol, `GameState.setup`, lobby | Needs a plan | Plan with Argon; implementation waits for Claude | No |
| 11 | **14D Rules audit** | read-only | Waits for Claude (rule judgement) | — | — |
| 12 | **14I MVP release** | — | After everything above | Owner | Owner's command |

**A good weekend order** that never has two open PRs in the same area: #1 (Argon, engine) → while it's open, #4 and #6 (Hydrogen, docs) and the #3 plan (Argon) → #2 once #1 is merged → #3 and #5 implementations (client) → #7 plan. Leave #7's and #8's code PRs open for Claude.

## Deferred / Not decided
- **Deferred (known bug) — F3 from 14F:** `modelGap` measures flat 2D horizontal distance (`shared/src/engine/unitGeometry.ts:23-30`), so standing on the ground under an elevated target model scores `gap = 0` in `closestApproach` / `validateSquadChargeMove`. On 2026-11-14 the owner decided not to change this for now and to document it as a known bug (see `doc/plans/14F-performance.md` and `doc/ROADMAP.md`). **F1, F2, and F4** from 14F are triaged into Bugfix batch 2 (`2C` / `2E`, details in `doc/plans/14F-performance.md`).

## Releasing
Only when the owner decides to, and only by the owner:
1. Open a PR from `master` to `release` and let CI pass.
2. Merge it with a **merge commit, never squash** (squashing makes the branches diverge). If they have already diverged, ask Claude.
3. Merging it deploys the client to GitHub Pages and the signaling server to Azure. Check the lobby's build stamp afterwards.

## When Claude is back
Claude should: read this file and `14F-handover.md`; list the PRs merged and still open since `fba67a3` (`gh pr list --state all --limit 30`); review the open ones first (engine before client); re-check anything the owner merged under this policy; update `doc/ROADMAP.md` ticks; and then carry on with the queue.
