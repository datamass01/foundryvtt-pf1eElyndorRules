# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`foundryvtt-pf1eElyndorRules` — a Foundry VTT module (`elyndor-house-rules/`)
that layers the Elyndor campaign's Pathfinder 1e house rules on top of the
`pf1` game system, without forking or importing pf1's own source. It is
pure ESM, no build step, no `package.json`/bundler — `esmodules` in
`module.json` load straight from `scripts/`.

The house rules themselves (what the module implements) are specified in
`Docs/house-rules/character-creation-and-system-rules.md`. **`Docs/` and
`.claude/plans/` are gitignored** (local dev reference / planning notes,
not project deliverables) — they exist on disk here but won't show up in
`git status` or a fresh clone.

The full implementation plan and architecture rationale lives **outside
this repo** at `~/.claude/plans/ok-here-is-the-distributed-curry.md`.
Check it first for "what's next" — it has the Phased Build Order, a
Rule → Mechanism Mapping table, and a Verification section. The module's
own `elyndor-house-rules/README.md` is the second source of truth: it
tracks live-verification status, the "Known risks" list (what's built but
not yet exercised against a running Foundry world), and a per-area file
map.

## Commands

There is no build/lint/test CLI — this is a plain ESM module loaded
directly by Foundry, and its only test suite runs *inside* a live Foundry
world via the [Quench](https://github.com/Ethaks/FVTT-Quench) module
(`elyndor-house-rules/test/dual-class.test.mjs`, registered from
`scripts/module.mjs` only if Quench is installed/enabled). There's no
headless runner for it yet — running it means opening that world's
Quench UI and running the `elyndor-house-rules.dual-class` batch by name.

**Compendium packs must be recompiled after any `packs-source/*.yaml`
edit** — the yaml alone is not a loadable compendium; `module.json` points
Foundry at the compiled ClassicLevel DBs under `packs/`:

```
npx @foundryvtt/foundryvtt-cli package pack --yaml --type Module \
  --id elyndor-house-rules -t Item \
  --in packs-source/<name> --out packs/<name>
# then flatten:
mv packs/<name>/<name>/* packs/<name>/ && rmdir packs/<name>/<name>
```

**Live dev loop** (this machine has a `pf1e-test-bed` Foundry v13 + pf1
v11.11 world already set up): symlink `elyndor-house-rules/` into
`foundrydata/Data/modules/elyndor-house-rules`, then
`systemctl --user restart foundry.service` to pick up module/pack
changes, enable the module via Module Management, and drive verification
through the browser console (`javascript_tool`/direct API calls) for
exact numeric checks rather than manual clicking — see the module
README's "Setup used for this pass" and "Verification log" for the
pattern this project uses.

## Architecture

### Single-hook Change injection

Every additive house rule funnels through one handler in
`scripts/module.mjs`:

```js
Hooks.on("pf1AddDefaultChanges", (actor, changes) => {
  applyCharacterLevelFix(actor);      // must run first — see below
  applySavesAndBabChanges(actor, changes);
  applyFeatCountChange(actor, changes);
  applySkillPointsChange(actor, changes);
  applyMovementChanges(actor, changes);
});
```

This hands each function a fresh array pf1 concatenates onto the actor's
real Change list — every function here may only **add** Changes, never
remove/replace pf1's own (`applyCharacterLevelFix` is the one exception:
a direct field mutation, safe because of pf1's own prepare-pipeline
ordering — see its header comment). Registration order in this handler
matters: `applyCharacterLevelFix` corrects `attributes.hd.total`/
`details.level.value` before anything else (including the feat/skill
functions below it) reads them.

### Two ways to "cancel" a native pf1 computation — pick the right one

House rules sometimes need to override a value pf1 already computes
natively (per-class BAB, per-class skill points), not just add to it.
There are two patterns in this codebase, and mixing them up is a known,
previously-shipped anti-pattern:

- **Wrong**: push a same-magnitude negative Change to cancel the native
  one additively. Both the native `+` and the cancelling `−` still show
  up in the item's tooltip, which is confusing/wrong even though the math
  nets out.
- **Right**: suppress at the source instead, via `scripts/lib/wrap.mjs`'s
  `wrapAfter`/`wrapOwnAfter` prototype-patch helpers — post-hoc, no Change
  involved, nothing extra in any tooltip. See
  `registerSecondaryBabSuppression` (`changes/saves-bab-lag.mjs`) and
  `registerSkillRankSuppression` (`changes/skill-points-total.mjs`) for
  the two live examples.

These suppression wraps (and `registerPointBuyTier`, which mutates
`pf1.config`) are registered from the `"setup"` hook, **not** `"init"` —
`pf1.config`/`pf1.applications` aren't populated until pf1's own `init`
hook has run, so `init` is too early to read or wrap them.

### Deferred-formula timing rule (has bitten this codebase twice)

Any Change that depends on an ability modifier must read that modifier
**inside the Change's formula string** (e.g.
`"max(0, @abilities.dex.mod) * @level"`, evaluated later in pf1's normal
Changes-apply pass), never as a plain JS read
(`actor.system.abilities.dex.mod`) at the point the Change is pushed —
ability-score Changes haven't resolved yet when `pf1AddDefaultChanges`
fires, so an eager read silently captures a stale/unbuffed value. This
exact bug has recurred in two different files
(`changes/movement.mjs`, `changes/skill-points-total.mjs`) — check for it
in any new Change-pushing code that touches an ability modifier.

### Primary/Secondary dual-class model

The core mechanic (`scripts/class-roles.mjs`, `scripts/const.mjs`): each
class item gets a `role` flag (`primary`/`secondary`) via
`setClassRole()`, with an eligibility guard (rejects late-starting
casters as Secondary) and an advisory (never blocking) lockstep-drift
warning fired off `pf1ClassLevelChange`. Downstream, Secondary's base
save/BAB/skill contribution is computed at a **lagged level**
(`SECONDARY_LEVEL_LAG = 2`, floored at `SECONDARY_LEVEL_FLOOR`), not its
own lockstep level — `scripts/lib/formulas.mjs`'s
`recomputeClassSaveAtLevel`/`compareDualClassSave` re-derive pf1's own
class-save-table formula at an arbitrary level for this comparison
(mirroring pf1's `class-model.mjs` math so the recomputed value is
directly comparable to the class item's own already-computed base).

### Compendium content: `packs-source/` vs `packs/`

`packs-source/*.yaml` is the human-edited source (hand-assigned ids
prefixed `eLy...`, **must be exactly 16 characters** — Foundry silently
sets a short id's loaded `_id` to `null` instead of rejecting/padding it,
which produces visually-identical unselectable duplicates in the
compendium browser; this has happened before and was fixed by padding).
`packs/` holds the compiled ClassicLevel DBs `module.json` actually
points Foundry at, and must be recompiled (see Commands above) after
every yaml edit — the two can silently drift out of sync otherwise.
Item descriptions intentionally don't duplicate pf1 core's full flavor
text where only a mechanical field changes — they summarize the house
rule and point at the corresponding `RefCode/packs/**/*.yaml` source
instead, to avoid maintaining two copies of the same content.

## Critical gotcha: verify every `globalThis.pf1`/hook reference live

`RefCode/` (gitignored — a separate reference-only checkout of the
upstream `foundryvtt-pathfinder1` repo, not part of this project) reports
the same pf1 version string as the actually-installed build on this
machine's dev world, but its checked-out source is ahead of what's
actually shipped. Several hook names/API paths RefCode documents simply
don't exist or never fire in the real v11.11 bundle — they register with
no error (`Hooks.on` doesn't validate names) and then silently no-op,
which is exactly how every house rule in this module shipped as a no-op
once already, undetected until a live test caught it:

| RefCode says | Actually fires/exists (verified live) |
|---|---|
| `Hooks.on("pf1.change.defaults", ...)` | `Hooks.on("pf1AddDefaultChanges", (actor, changes) => ...)` |
| `Hooks.on("pf1.item.level", (item) => ...)` | `Hooks.on("pf1ClassLevelChange", (actor, item, newLevel, oldLevel) => ...)` |
| `new pf1.models.components.Change(...)` | `new pf1.components.ItemChange(...)` (`pf1.models.components` doesn't exist) |
| `pf1.settings.fractional` | `game.settings.get("pf1", "useFractionalBaseBonuses")` (`pf1.settings` doesn't exist) |
| `Hooks.on("renderClassSheetPF", ...)` | `Hooks.on("renderItemSheetPF", ...)` filtered to `item.type === "class"` (no dedicated class sheet) |
| `Hooks.on("renderCharacterSheetPF", ...)` | `Hooks.on("renderActorSheetPFCharacter", ...)` |
| `pf1.config.favoredClassTypes` is a `Set` (`.has`) | it's a plain Array (`.includes`) in the installed build |

**Rule for all future work on this module**: treat every
`globalThis.pf1`/hook-name reference as unverified until checked against
`Hooks.events` or the served `pf1.js` bundle text on the actual target
install — never trust RefCode's source alone. Per
`RefCode/docs/API.md`, this module also intentionally imports nothing
from pf1's own source files, only the documented `globalThis.pf1` API and
Foundry core hooks.

## Foundry version-compat notes

Before touching sheets, templates, window CSS, TypeDataModels, or packs,
read `Docs/foundry-dev/v13-v14-agent-notes.md` (gitignored, local only) —
it documents paid-for v13 bugs not to reintroduce, this repo's
ApplicationV2 standards, and the v14 dual-compatibility rules.
