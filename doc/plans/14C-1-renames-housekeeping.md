# 14C-1: Renames to OPR terms, disclaimer, developer mode, project rules
Status: approved
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14C (part 1 of 3). Umbrella: `doc/plans/14C-opr-v3.6-alignment.md`.

## Goal
The code and the screen use One Page Rules' own words: Tough, AP, Rending, Hero, Advance, Shaken and so on. Game mechanics stay **exactly as they are today**; 14C-2 changes the rules. A one-line disclaimer appears in the lobby and the README. The TEST armies hide behind a developer mode, toggled with F9 on the main menu. AGENTS.md, the implementer agent and the plan references stop enforcing clean-room naming and point at the v3.6 PDFs.

## Decisions (agreed)
1. **Renames only, no rule changes.** Every test keeps its assertions; only names change. A behaviour change in this sub-plan is a bug.
2. **Core special-rule IDs and display names** (`shared/src/rules/traits.ts` `CoreTraitId` / `TRAIT_REGISTRY`, every trait string in data, tests and HUD text):

   | Old ID | New ID | Display |
   |---|---|---|
   | `drop-reserve` | `ambush` | Ambush |
   | `pierce(X)` | `ap(X)` | AP(X) |
   | `hexed` | `bane` | Bane |
   | `blast(X)` | `blast(X)` | Blast(X) |
   | `channeler(X)` | `caster(X)` | Caster(X) |
   | `brace` | `counter` | Counter |
   | `lethal(X)` | `deadly(X)` | Deadly(X) |
   | `swift` | `fast` | Fast |
   | `dread(X)` | `fear(X)` | Fear(X) |
   | `stoic` | `fearless` | Fearless |
   | `airborne` | `flying` | Flying |
   | `frenzy` | `furious` | Furious |
   | `commander` | `hero` | Hero |
   | `stationary` | `immobile` | Immobile |
   | `shock(X)` | `impact(X)` | Impact(X) |
   | `lobbed` | `indirect` | Indirect |
   | `expendable` | `limited` | Limited |
   | `ward` | `regeneration` | Regeneration |
   | `sustained` | `relentless` | Relentless |
   | `calibrated` | `reliable` | Reliable |
   | `shred` | `rending` | Rending |
   | `vanguard` | `scout` | Scout |
   | `ponderous` | `slow` | Slow |
   | `camouflaged` | `stealth` | Stealth |
   | `pathfinder` | `strider` | Strider |
   | `overload` | `surge` | Surge |
   | `impale` | `thrust` | Thrust |
   | `resilient(X)` | `tough(X)` | Tough(X) |
   | `unerring` | `unstoppable` | Unstoppable |

   - **No aliases:** a clean break (umbrella Decision 5). The old IDs must not appear anywhere in the code afterwards.
   - **`shred` becomes `rending`.** v3.6 has a different rule called Shred that 14C-2 adds, so no `shred` ID may remain after this PR.
   - **`pierce` becomes `ap`.** Prime Brothers has an unrelated faction rule called Pierce, which arrives in 14C-3.
3. **Faction traits stay as they are** (`steadfast`, `marksman`, `riot-shield`, `iron-will`, `order-*`, `aura-*` and so on). They belong to the invented armies, and 14C-3 replaces them with each v3.6 army book's own rules.
4. **Actions:** the action type `move-unit` becomes **`advance`** (payload `type: 'advance'`; HUD button and log text "Advance"). `rush`, `charge`, `hold`, `begin-charge`, `charge-leg`, `fight` and the reaction actions keep their names. Old snapshots containing `move-unit` are not supported.
5. **Statuses and labels:**
   - "Suppressed" becomes **Shaken** in every display string. The status IDs stay (`stunned` is removed in 14C-2).
   - The data card's "Toughness" column becomes **Tough**.
   - "Resolve", "Armor", "Eliminated" and "Knocked Out" in display text become **Quality**, **Defense** and **Killed** (where the meaning is "removed from play").
   - Wording that describes the old wound-effect table stays until 14C-2 removes that table.
6. **Rule help in our own words.** Each `TRAIT_REGISTRY` description becomes a one-sentence summary in our own words of what **our engine does today**; 14C-2 updates them as rules change. Nothing is copied from the PDFs. The rules panel or tooltip area gets a line: "Full rules: onepagerules.com (free)". If there's no single natural home for it, put it in the lobby footer next to the disclaimer.
7. **Disclaimer:** the lobby footer and the README both carry "Unofficial fan project for One Page Rules games. Not affiliated with or endorsed by One Page Rules." No OPR logos or art anywhere.
8. **Developer mode:**
   - **Toggle:** F9 **while the lobby or main menu is showing** switches developer mode on and off. It's saved in `localStorage` (`skirmish_lab_dev_mode`); in-game F9 is unchanged.
   - **When on:** a small "DEV" badge shows in the lobby corner, and the TEST armies (`test-army`, `test-squad-army`) appear in both army pickers.
   - **When off (the default):** the TEST armies are hidden, and a stored selection of a TEST army falls back to the default army.
   - Turning it on or off shows a short toast: "Developer mode on" / "Developer mode off".
9. **Project rules** (AGENTS.md, `.claude/agents/implementer.md`, `doc/plans/README.md`) are rewritten to match umbrella Decision 1:
   - use OPR's names and match v3.6 mechanics;
   - keep the disclaimer;
   - no OPR logos or art;
   - never paste rulebook or army-book text (summaries in our own words);
   - nothing from Patreon-only files.

   The "Terminology mapping" requirement and the "first principles / original data" bullets are removed. `doc/plans/README.md`'s rule references list the v3.6 files.
10. **The term-mapping file** (`assets-src/OPR_TERM_MAPPING.md`, local only) gets a header note saying it is historical after 14C-1. It isn't deleted until 14C-3 finishes the armies. Opus does this, since it lives outside the repo.

## Out of scope
- Any rule or number change (14C-2).
- Unit, weapon and army names of Frontier Wardens / Rust Raiders (removed in 14C-3).
- Faction traits (14C-3).
- Saved-session compatibility (clean break).
- Product name (stays SkirmishLab).

## Background
- **Traits:** `shared/src/rules/traits.ts` (`CoreTraitId`, `FactionTraitId`, `TRAIT_REGISTRY`, parser `TRAIT_PATTERN`, `hasTrait` / value helpers).
  - `grep -rhoE "hasTrait\([^,]+, '[a-z-]+'" shared/src` lists engine uses (`airborne`, `pathfinder`, `commander`, `calibrated`, ...).
  - Value traits: `blast`, `dread`, `lethal`, `resilient` (+ `pierce` in weapon profiles).
- **Data:** `shared/src/data/weapons.ts`, `shared/src/data/armies.ts` (trait strings), `shared/src/gameTypes.ts` (`ActionType`, `ActionPayload`).
- **Action rename:** `move-unit` appears in 29 files across shared, client and server (`grep -rl "'move-unit'"`). The client `GameManager`, the HUD's submit paths and the log labels all use it.
- **HUD:** data card (`GameHUD.ts` ~3974), action buttons, log text and toasts (search for the old display names).
- **Lobby:** army pickers with hardcoded TEST options (`client/src/ui/Lobby.ts` ~354–364); keyboard handling for F9 currently lives in-game only.
- **Docs that use the old names:** RULES_SPECIFICATION, SYSTEMS, DATA_MODEL, GDD, NETWORKING, ASSETS, README.
- **Process:** server tests use `shared/dist`, so rebuild shared before running server tests.

## PR 1: Rename core rules and the Advance action  (branch: `14C-1-renames-1`)
- **Layer:** shared + client + server. A mechanical rename across workspaces; this exception is allowed because the code doesn't compile half-renamed.
- **Files:** `shared/src/rules/traits.ts`, `shared/src/gameTypes.ts`, `shared/src/engine/*`, `shared/src/data/*`, `client/src/**` (HUD, GameManager, renderer labels), all tests that use the old IDs or `move-unit`, and `server/` if it references action types.
- **Tests first:**
  - A new `shared/tests/rules/renames.test.ts` guards the rename:
    - every v3.6 core rule ID in Decision 2 is in `TRAIT_REGISTRY` with the listed display name;
    - none of the old IDs parse to a known trait;
    - a source scan (read the `shared/src` and `client/src` files as text) finds none of the old core IDs or `'move-unit'`.
  - Existing tests: only rename strings; no assertion values change.
- **Implementation steps:**
  1. Rename `CoreTraitId` and the registry.
  2. Rename the trait strings in the data.
  3. Rename `hasTrait` and value lookups in the engine.
  4. Rename `move-unit` to `advance` everywhere.
  5. Update the HUD display names.
  6. Rewrite registry descriptions in our own words (Decision 6).
- **Docs:** RULES_SPECIFICATION section 9 (the trait matrix with the new names) and every other doc's use of the old names; DATA_MODEL (action type); NETWORKING (action list); ROADMAP note.
- **Manual checks:** none beyond a smoke game (covered in PR 2's checklist item).
- **Done when:** all workspaces pass, the scan test is green, and `grep -rnE "'(pierce|shred|resilient|airborne|pathfinder|commander|calibrated|lobbed|move-unit)'" shared/src client/src server/src` finds nothing.

## PR 2: Disclaimer, labels, rules link, developer mode  (branch: `14C-1-renames-2`)
- **Layer:** client UI + README
- **Files:** `client/src/ui/Lobby.ts`, `client/src/ui/GameHUD.ts` (labels from Decision 5, the rules link if it lives there), `client/src/main.ts` (only if the F9 listener belongs there), new `client/src/ui/devMode.ts` (read/write the flag), `README.md`, tests in `client/tests/ui/Lobby.test.ts` and new `client/tests/ui/devMode.test.ts`.
- **Tests first:**
  - The lobby footer shows the disclaimer text.
  - With dev mode off, the army pickers have no TEST options, and a stored `test-army` selection falls back to the default.
  - F9 in the lobby turns dev mode on: the DEV badge shows, the TEST options appear, the toast reads "Developer mode on", and the flag persists across a re-render or new Lobby. F9 again turns it off.
  - F9 during a game does not toggle dev mode.
  - The data card header reads "Tough"; no display string says "Suppressed".
- **Implementation steps:**
  1. The `devMode` helper.
  2. The lobby F9 listener (only while the lobby is visible), the badge and the conditional TEST options.
  3. Labels.
  4. The footer disclaimer and rules link.
  5. The README section: what SkirmishLab is, the disclaimer, a link to OPR.
- **Docs:** SYSTEMS (dev mode), ROADMAP note, the manual checklist (below).
- **Manual checks** (section 9):
  - **Default:** the lobby shows the disclaimer and no TEST armies.
  - **F9 toggle:** F9 on the main menu shows "Developer mode on", the DEV badge and the TEST armies. A reload keeps it, and F9 again hides them.
  - **In game:** F9 still opens the LoS debugger and doesn't touch dev mode.
  - **Smoke game:** play a few activations. Data cards show AP / Tough / Rending, the button and log say Advance, and nothing reads "Suppressed".
- **Done when:** tests pass and the manual items are added.

## PR 3: Project rules and docs  (branch: `14C-1-renames-3`)
- **Layer:** docs and process only. No code.
- **Files:** `AGENTS.md` (the IP & Legal Constraints section, the Documentation Requirements bullet about the term mapping, and the Don'ts about rulebook text/army data reworded per Decision 9), `.claude/agents/implementer.md` (the clean-room hard rule and the §5 term-mapping duty), `doc/plans/README.md` (rule references → v3.6 files, the clean-room line), `doc/GDD.md` and others that describe the project as clean-room.
- **Tests first:** n/a (docs only).
- **Implementation steps:**
  1. Rewrite the IP section to: unofficial fan project; OPR names and v3.6 mechanics; disclaimer; no logos or art; no pasted rule text; no Patreon-only content; monetisation still out of scope.
  2. Update the implementer's hard rules.
  3. Update the plan README references (absolute paths to the v3.6 PDFs; mark the Beginner's Guide terrain chapter and the Tournament Guidelines terrain/points sections as the useful parts).
- **Docs:** this PR is docs.
- **Manual checks:** none.
- **Done when:** a reader of AGENTS.md and the implementer prompt would not refuse OPR names, and would still refuse to paste rulebook text. Opus adds the historical note to the local term mapping (Decision 10) and updates its own memory notes when merging.

## Open questions
None.
