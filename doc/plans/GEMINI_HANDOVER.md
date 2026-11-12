# Handing a PR to Gemini

How to give one approved PR section to Gemini (Antigravity or Gemini CLI) instead of a Claude `implementer` agent, and how it comes back. The normal workflow is in [README.md](README.md): Fable plans, an implementer builds one PR section, Fable reviews and merges. Gemini takes the implementer's place for that one section; the plan, review and merge steps don't change.

## What to give Gemini
Good fits are self-contained, client-only or docs-only work that's easy to check by hand, where a mistake is cheap:
- small lobby or HUD features with no rule logic (e.g. `14G-wake-up-indicator.md`);
- read-only reviews that produce a findings list and change no code (e.g. a first pass of 14E). Fable checks the findings before they go into a bugfix batch.

Keep these with Claude:
- anything that changes rules, the engine's host validation, the P2P protocol or `GameState` (e.g. each player picking their own army);
- rules audits (14D): they need rule judgement and carry the risk of rulebook text being pasted;
- work that touches files another PR is changing at the same time.

## Before the handover (Fable, main session)
1. The plan exists in `doc/plans/`, its **Status is approved** and its Open questions are empty. Gemini can't ask the owner anything, so the plan must be its whole brief.
2. No running PR touches the same files. If one does, merge it first.
3. `master` is up to date on GitHub (`git fetch`; the plan itself is merged).
4. Note the handover in the plan's Status line: `in progress (Gemini, <date>)`.

## Standard rules for every Gemini job
Short job prompts say "follow the standard rules in doc/plans/GEMINI_HANDOVER.md". They are:
1. Read AGENTS.md and `.claude/agents/implementer.md` first and follow them, except: you are not a Claude agent, ignore anything about Sonnet, Fable or subagents, and your report goes to the project owner.
2. Work in your own worktree, never in the main checkout: `git fetch && git worktree add .claude/worktrees/<branch> origin/master -b <branch> && cd .claude/worktrees/<branch> && npm ci`.
3. Do only the job you were given. List anything else you notice in the report and leave it alone. No gameplay or rules changes unless the job says so; on a rules doubt, stop and report.
4. Confirm a finding before fixing it (a failing test for behaviour, a grep for dead code); skip and report any you can't confirm.
5. Tests first (Vitest). Before the PR, all must pass: `npm run build --workspace=shared`, `npm run test --workspace=shared`, `npm run test --workspace=server`, `npm run test --workspace=client`, `npm run build`. Never skip, `.only` or delete a failing test to get green.
6. Never merge a PR, never push to master or release, never open anything against release. Never run `git reset --hard`, `git clean` or `git checkout -- <file>` on files you didn't create, never use `git commit -a`, never pop or drop a stash you didn't make.
7. Never paste text from the rule PDFs in assets-src/.
8. Docs: update what the job lists; mark 14E findings "fixed in <PR>" / "not confirmed" in doc/reviews/14E-gemini-findings.md when the job fixes findings; manual checks go into doc/manual-testing/MANUAL_TEST_CHECKLIST.md in the existing `- [ ] **Title.** Setup: …` format; UI inventory: update `tools/ux-inventory/catalog.js` text (escape apostrophes as `\'`) and list screenshots needed, don't take them.
9. Commits end with `Co-Authored-By: Gemini <noreply@google.com>`. Open the PR with `gh pr create --base master`; the body has the summary, tests, what a player will notice, manual checks, and "Implemented by Gemini; for Claude review." Wait for CI (`gh pr checks <n> --watch`) and fix failures.
10. Report: PR URL, CI status, test counts per workspace, what changed, findings not confirmed, deviations, manual checks added, screenshots needed.

## The prompt
Paste this into Gemini, filling in the two placeholders. It points Gemini at the same rules a Claude implementer follows (`.claude/agents/implementer.md`), so the two never drift apart.

```text
You are implementing one PR for SkirmishLab, a TypeScript + Three.js tabletop skirmish simulator in this repository.

Your task: PR section "<PR heading, e.g. PR 1: Wake-up indicator in the lobby>" of the plan <plan path, e.g. doc/plans/14G-wake-up-indicator.md>. Use the branch name the plan gives.

Before writing any code, read in full:
1. AGENTS.md: the project rules. They apply to you even though the file is not called GEMINI.md.
2. .claude/agents/implementer.md: your working rules. Follow them exactly, with three differences: you are not a Claude agent; ignore anything about Sonnet, Fable or subagents; and your final report goes to the project owner, who passes it on to the reviewer.
3. The plan file. Its "Decisions (agreed)" are fixed: do not reopen or change them.
4. The docs and code the plan's Background section names.

Hard rules (stop and report rather than break any of them):
- Do only that one PR section. If you notice anything else, list it in your report and leave it alone.
- No gameplay or rules changes. If the plan seems to need one, stop and say so.
- Branch from origin/master (run `git fetch` first, and `npm ci` in a fresh checkout). Open the PR against master with `gh pr create --base master`.
- Never merge a PR. Never push to master or release. Never open anything against the release branch.
- Never run `git reset --hard`, `git clean` or `git checkout -- <file>` on files you didn't create, and never drop or pop a git stash you didn't make.
- Never paste text from the rule PDFs in assets-src/. Describe mechanics in your own words.
- Write the plan's tests first (Vitest), then the code.
- Before opening the PR, all of these must pass:
  npm run build --workspace=shared
  npm run test --workspace=shared
  npm run test --workspace=server
  npm run test --workspace=client
  npm run build
  Never skip, `.only` or delete a failing test to get green.
- Update the docs the plan lists, and add the plan's manual checks to doc/manual-testing/MANUAL_TEST_CHECKLIST.md. Don't create new checklist files, and don't remove items the owner hasn't ticked.
- If the plan asks for UI inventory screenshots, update the text in tools/ux-inventory/catalog.js and list the entries that need new screenshots. Don't try to take them yourself.
- End every commit message with the line: Co-Authored-By: Gemini <noreply@google.com>
- In the PR description, include: the summary, the plan file and section, the tests added, any behaviour a player would notice, the manual checks added, and the line "Implemented by Gemini; for Claude review."
- Wait for CI (`gh pr checks <number> --watch`). If it fails, fix it and push again.

When you are done, reply with a short report:
- PR URL, branch, CI status, test counts per workspace;
- what changed (files and behaviour);
- any deviations from the plan, and why;
- blockers, open questions and out-of-scope issues you noticed;
- the manual checklist items you added, and any screenshots that need re-taking.
```

## After Gemini reports
1. The owner pastes Gemini's report into the Claude session ("Gemini finished, here's its report") or just gives the PR number.
2. Fable reviews the PR exactly as it would a Claude implementer's: diff against the plan and the rules, all workspaces green in CI, docs and checklist updated, no stray files (no `client/ux-harness.html`, no scratch scripts), and the commit trailers.
3. Small fixes Fable patches directly on the branch. Bigger ones go back to Gemini as a follow-up prompt: "Fix these review points on the same branch and push: …".
4. Fable squash-merges to `master`, pulls the main checkout (`git pull --ff-only --autostash`), deletes the branch, re-takes any UI inventory screenshots, and updates the plan's Status (`done, merged as #N`).
5. Releases still need the owner's explicit command, whoever wrote the code.
