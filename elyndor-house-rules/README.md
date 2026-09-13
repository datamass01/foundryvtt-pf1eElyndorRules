# Elyndor House Rules

A companion Foundry VTT module implementing the Elyndor campaign's
Pathfinder 1e house rules on top of the `pf1` system — see
`Docs/house-rules/character-creation-and-system-rules.md` (in the parent
project) for the rules themselves, and
`/home/entropy/.claude/plans/ok-here-is-the-distributed-curry.md` for the
full implementation plan and architecture rationale.

## Status

**Run and verified live** against a Foundry v13.351 + pf1 v11.11 dev world
(`pf1e-test-bed`, on this machine — see Dev setup). This surfaced a
significant finding: **RefCode's checked-out source is ahead of the
actually-installed v11.11 build**, despite both reporting the identical
version string. Several hooks/API paths this module (and the plan) were
built against, all taken directly from RefCode/hooks.d.ts and the wider
source, simply don't exist in the shipped `pf1.js` bundle. Confirmed via
the bundle text and live `Hooks.events` inspection:

| RefCode says | Actually fires/exists (verified) | Fixed in |
|---|---|---|
| `Hooks.on("pf1.change.defaults", ...)` | `Hooks.on("pf1AddDefaultChanges", ...)` (same `(actor, changes)` signature) | `scripts/module.mjs` |
| `Hooks.on("pf1.item.level", (item) => ...)` | `Hooks.on("pf1ClassLevelChange", (actor, item, newLevel, oldLevel) => ...)` | `scripts/module.mjs` |
| `new pf1.models.components.Change(...)` | `pf1.models.components` doesn't exist at all; use `new pf1.components.ItemChange(...)` | all `scripts/changes/*.mjs` |
| `pf1.settings.fractional` | `pf1.settings` doesn't exist; use `game.settings.get("pf1", "useFractionalBaseBonuses")` | `scripts/lib/formulas.mjs` |
| `Hooks.on("renderClassSheetPF", ...)` | No dedicated class sheet — every item type shares `ItemSheetPF`; hook is `renderItemSheetPF` (now filtered to `item.type === "class"`) | `scripts/ui/class-role-toggle.mjs` |
| `Hooks.on("renderCharacterSheetPF", ...)` | `Hooks.on("renderActorSheetPFCharacter", ...)` | `scripts/ui/skill-pool-panel.mjs` |

Every one of these registered fine (no error — `Hooks.on` doesn't validate
the name) but silently never fired or never resolved, so **every house
rule was a no-op until this pass caught it live**: BAB, saves, feats,
skill points, and movement all computed as vanilla pf1 (no house rules
applied at all) before these fixes, despite the module loading cleanly
with zero console errors. This is exactly why the plan called for a live
spike before trusting anything — take it as a standing warning for *any*
future addition built by reading RefCode alone: **treat every
`globalThis.pf1`/hook-name reference as unverified until checked against
`Hooks.events` or the served `pf1.js` bundle text on the actual target
install**, not just RefCode's source.

A second, independent bug (not a wrong name — a genuine timing issue) was
also found and fixed live: `movement.mjs` computed its Dex-to-speed delta
*eagerly*, reading `actor.system.abilities.dex.mod`/`.total` at
`pf1AddDefaultChanges`-fire time — but ability-score Changes haven't been
applied yet at that point in pf1's prepare pipeline, so it silently read
stale/unmodified values every cycle. Fixed by deferring the ability-
dependent part into the pushed Change's own formula string (evaluated
later, after abilities resolve) — the same pattern the doubled-save-
ability-mod Changes already used correctly. See `scripts/changes/movement.mjs`
for the full explanation.

A third bug, unrelated to the hook drift above: **five of the eleven
compendium item ids were 14-15 characters, not the required 16** (exactly
the ones the "Compendium ID scheme" section below already flagged as
unverified). Confirmed live: Foundry doesn't reject or pad a short `_id` —
it silently sets the loaded document's `_id` to `null` instead, and the
affected items appeared as visually-indistinguishable duplicates in the
compendium browser. Fixed by padding all five to 16 characters
(`packs-source/elyndor-classes/{cleric,favored-terrain,paladin,ranger,rogue}...yaml`
and the one cross-reference to Favored Terrain's id from `ranger`'s
`links.supplements`), then recompiling.

**All fixes above were confirmed live**, not just patched-and-assumed —
see the verification log below.

### Verification log (this session)

Built a level-5 Fighter(Primary)/Sorcerer(Secondary) test actor
(`Elyndor Test - Fighter+Sorc`, left in the `pf1e-test-bed` world) with
STR10/DEX10/CON14/INT12/WIS10/CHA14 and hand-checked every derived value
against the house rules in `Docs/house-rules`:

| Check | Expected | Actual (live) |
|---|---|---|
| BAB (Primary only) | 5 (Fighter@5 high) | **5** ✓ |
| Character level / HD (no doubling) | 5 | **5** ✓ |
| Fort (max(Prim,Sec@-2) + CON + STR) | max(4,1)+2+0 = 6 | **6** ✓ |
| Ref (+ INT as 2nd ability) | max(1,1)+0+1 = 2 | **2** ✓ |
| Will (+ CHA as 2nd ability) | max(1,3)+0+2 = 5 | **5** ✓ |
| Skill points (aggregate delta) | +5/level vs. core | **+5** ✓ |
| Movement: baseline, permanent +2 Dex | 30+10 = 40 | **40** ✓ |
| Movement: +4 temp buff on top (should NOT stack) | still 40 | **40** ✓ |
| Movement: -6 Dex debuff (should reduce, floor at racial base) | 30 | **30** ✓ |
| Class-role toggle renders on the class Item Sheet | Primary/Secondary radio, correct state | ✓ (screenshot-confirmed) |
| Skill-pool advisory panel renders on the Skills tab | 7 pools, correct per-pool totals | ✓ (screenshot-confirmed; also needed an unrelated markup fix — the skills tab is a `<div>` not a `<section>`, see `skill-pool-panel.mjs`) |
| All 3 compendium packs load, browsable, correct doc counts | 8/2/1 items | ✓ |

**Not yet exercised live**: the Fractional Base Bonuses world-setting
interaction (item 1 below), the Cleric/Rogue/Paladin data-only overrides
(armor prof, Turn Undead, Weapon Finesse — low risk, pure data), the
Druid/Ranger animal-companion-removal overrides, and the Quench suite
(Quench itself isn't installed in this world yet). See "Known risks"
below for what's still open.

### Setup used for this pass

1. Foundry v13 + pf1 v11.11 world (`pf1e-test-bed`), already present on
   this machine with `pf1` and PF-content modules installed.
2. Symlinked this module into `foundrydata/Data/modules/elyndor-house-rules`.
3. Compiled `packs/*` from `packs-source/*` (the actual yaml sources now
   live under `packs-source/`; `packs/` holds the compiled ClassicLevel
   compendium databases module.json points at) via
   `@foundryvtt/foundryvtt-cli`'s `package pack --yaml` — **the raw yaml
   files alone are not a loadable compendium**; they must be compiled
   first. See `packs/README` note below or re-run:
   ```
   npx @foundryvtt/foundryvtt-cli package pack --yaml --type Module \
     --id elyndor-house-rules -t Item \
     --in packs-source/<name> --out packs/<name>
   # then flatten: mv packs/<name>/<name>/* packs/<name>/ && rmdir packs/<name>/<name>
   ```
4. Enabled the module via Module Management, then worked through the
   scenarios above using the browser console (`javascript_tool`/direct
   API calls) rather than manual clicking, for exact numeric verification.

## What's implemented

| Area | File(s) |
|---|---|
| Primary/Secondary role flag + eligibility + lockstep-drift warning | `scripts/class-roles.mjs` |
| Hit Dice / character level don't double under lockstep leveling (also fixes latent CON-to-HP and rest-healing doubling) | `scripts/changes/character-level.mjs` |
| BAB (Primary only) + base save max(Primary, Secondary@-2) + doubled save ability mods | `scripts/changes/saves-bab-lag.mjs`, `scripts/lib/formulas.mjs` |
| 1 feat/level | `scripts/changes/feats.mjs` |
| Skill points: aggregate 7-pool total | `scripts/changes/skill-points-total.mjs`, `scripts/lib/formulas.mjs` |
| Skill points: per-pool advisory readout | `scripts/ui/skill-pool-panel.mjs`, `templates/skill-pool-panel.hbs` |
| Dex-to-speed scaling (permanent mod only, floored at racial base) | `scripts/changes/movement.mjs` |
| Class-role toggle UI (class Item Sheet) | `scripts/ui/class-role-toggle.mjs`, `templates/class-role-toggle.hbs` |
| Class Role column on the character sheet classes list | `scripts/ui/class-role-column.mjs` |
| Point buy 30-point tier | `scripts/settings.mjs` |
| Cleric: heavy armor + free Turn/Command Undead | `packs-source/elyndor-classes/cleric.eLyClericCls0001.yaml` |
| Rogue: free Weapon Finesse | `packs-source/elyndor-classes/rogue.eLyRogueCls00001.yaml` |
| Paladin: alignment/deity text update (nothing to override in code) | `packs-source/elyndor-classes/paladin.eLyPaladinCls001.yaml` |
| Ranger: Favored Terrain "2 terrains" text update; Hunter's Bond no longer offers an animal companion | `packs-source/elyndor-classes/ranger.eLyRangerCls0001.yaml`, `favored-terrain.eLyFavTerr000001.yaml`, `hunter-s-bond.eLyHunterBond001.yaml` |
| Druid: Nature Bond no longer offers an animal companion (domain only) | `packs-source/elyndor-classes/druid.eLyDruidClass001.yaml`, `nature-bond.eLyNatureBond001.yaml` |
| Base land speed 20/15 ft. (Medium/Small), every pf1-core race | `packs-source/elyndor-races/*.yaml` (79 items: 77 generated Elyndor overrides of every Medium/Small race the pf1 system's own core Races compendium ships, plus the hand-authored Dwarf and Lythari below; Large races Ogre/Trox are untouched — §8.1 doesn't define a Large value) |
| Dwarf base speed 15 ft. (Small-style carve-out despite Medium size) | `packs-source/elyndor-races/dwarf.eLyDwarfRace001a.yaml` |
| Lythari (new custom race: Fey lycanthrope elf-kin) | `packs-source/elyndor-races/lythari.eLyLythariRace1a.yaml` |
| Run feat +5 ft. | `packs-source/elyndor-feats/run.eLyRunFeat0001aa.yaml` |
| Versatile Channeler (Elyndor): drops the original (Ultimate Magic) neutral-alignment prerequisite — good and evil channelers may take it too | `packs-source/elyndor-feats/versatile-channeler.eLyVersaChan0001.yaml` |
| Vindicator's Stability (Elyndor, new feat, no published source): Antipaladin + Versatile Channeler (Elyndor) prereqs; lets touch of corruption also be used exactly as a paladin's lay on hands (heal a living creature, not just harm/heal-undead), same daily use pool | `packs-source/elyndor-feats/vindicators-stability.eLyVindicStab001.yaml` |
| Skill Bonus Conversion (§2.3): non-rank/non-ability skill bonuses summed and converted — 2-5 → +2, 6-10 → Advantage (2d20kh1), 11+ → both | `scripts/changes/skill-bonus-conversion.mjs` |
| Quench test scaffold | `test/dual-class.test.mjs` |

**Note:** `packs-source/` holds the human-edited yaml source (renamed here
during this session — see Status above); `packs/` holds the *compiled*
ClassicLevel compendium databases that `module.json` actually points
Foundry at and must be regenerated from `packs-source/` after any yaml
edit (see "Setup used for this pass" above for the compile command).

**Rogue's "new Advanced Talent: Hide in Plain Sight" was NOT built as new
content.** pf1 already ships `Hide in Plain Sight (ROG)`
(`Compendium.pf1.class-abilities.Item.k2DralSO0RIdeilQ`), already tagged
`associations.classes: [Rogue, Rogue (Unchained), Ninja]` and discoverable
via the Compendium Browser's talent filter. This house rule may already be
satisfied by vanilla pf1 — confirm with the GM before authoring a duplicate.

## Known risks — verify these live before trusting them at the table

1. **RESOLVED (verified live) — Base land speed reduction now covers every
   pf1-core Medium/Small race, not just Dwarf.** §8.1 is a *relative*
   reduction, not a flat cap: **−10 ft. for Medium races, −5 ft. for Small
   races**, floored at a minimum of 5 ft. (never below that, regardless of
   how slow a race's core speed already is). `packs-source/elyndor-races/`
   has 79 items: a generated Elyndor override of every Medium- and
   Small-size race in the pf1 system's own core Races compendium (77 races,
   auto-derived from the shipped `pf1.js`/compendium data — everything else
   about each race is byte-for-byte unchanged, only `speeds.land` is
   reduced), plus the pre-existing hand-authored Dwarf (special-cased, own
   fixed 15 ft., untouched by this formula) and Lythari (20 ft.) entries.
   Live-verified: fresh test actors built from the Human (Elyndor) and
   Goblin (Elyndor) compendium items resolve `system.attributes.speed.land.base`
   of **20** (30−10) and **25** (30−5) respectively; the Dex-to-speed house
   rule (`movement.mjs`) and non-land movement modes were separately
   confirmed unaffected by this change in an earlier pass on the same
   mechanism. Large-size races (Ogre, Trox) are intentionally left alone —
   §8.1 only defines Medium/Small.
   The relative formula (vs. an earlier flat-cap draft) resolves what would
   otherwise be two GM-facing oddities:
   - **Fast-Small races keep their edge.** Core pf1 gives Goblin, Kobold,
     and Grippli a Small-race exception (30 ft., not the normal Small
     20 ft.). The −5 ft. relative reduction leaves them at 25 ft. — still
     faster than a normal Small race's 15 ft., preserving the racial trait
     instead of flattening it away.
   - **No race increases in speed.** The four Medium-but-aquatic races
     (Adaro, Locathah, Merfolk, Triton — core land speed only 5–10 ft.,
     their real mobility is `swim`) all land on the 5 ft. floor: Adaro/
     Locathah drop from 10 to 5, Merfolk/Triton stay at 5. Nothing goes up.

2. **OPEN — Fractional Base Bonuses interaction** (`changes/saves-bab-lag.mjs`).
   The save-lag delta is computed by diffing against each class's own
   already-computed `savingThrows[id].base`, which should be setting-agnostic
   in principle — but the "Fractional Base Bonuses" world setting changes
   pf1's own internal aggregation shape (per-class Change vs. one combined
   `floor(sum)` Change), and that interaction hasn't been tested live (the
   verification pass this session used the default, non-fractional setting).
   **Test**: toggle `game.settings.set("pf1", "useFractionalBaseBonuses", true)`,
   confirm the Will/Fort/Ref totals still match
   `max(primary.base, secondary.base@level-2)` plus ability mods.

3. **RESOLVED (verified live) — Permanent-vs-buffed Dex for movement**
   (`changes/movement.mjs`). All four scenarios from the plan's Verification
   §7 now pass live: baseline permanent +2 Dex → +10 ft; a temporary +4 Dex
   buff on top does not add further; a -6 Dex debuff correctly reduces speed
   back down; floored at racial base in both directions. Getting here also
   required fixing a genuine timing bug (see Status above) — the delta is
   now pushed as a Change formula string, not a precomputed number, so it's
   evaluated after abilities resolve rather than before.

4. **RESOLVED, now live-verified — `attributes.hd.total`/`details.level.value`
   no longer double under lockstep leveling** (confirmed on the level-5
   Fighter+Sorcerer test actor: both read 5, not 10 — see the verification
   log above). pf1 sums every class item's own
   `hitDice`/`level` into these two actor-wide fields
   (`base-character-model.mjs:1200-1216`, `_preparePostEmbedded()`); since
   Primary and Secondary both advance every character level, that sum came
   out to twice true character level before this fix. `scripts/changes/character-level.mjs`
   now runs first in the `pf1AddDefaultChanges` handler and directly
   subtracts Secondary's own contribution back out of both fields (robust
   to a third un-flagged class item ever being added — it doesn't just set
   the total to Primary's level). This was confirmed safe by checking
   pf1's own timing: `_preparePostEmbedded()` (which sets these fields) has
   already run by the time `pf1AddDefaultChanges` fires, while every
   consumer that matters (`applyChanges()`'s later resolution of Change
   *formula strings*, `getFeatCount()`, natural rest-healing) runs strictly
   after, so the correction is picked up everywhere.
   - **This fix also resolves two latent bugs the ruleset would otherwise
     have silently introduced**, both discovered while tracing this down:
     Constitution's contribution to max HP
     (`"@attributes.hpAbility.mod * @attributes.hd.total"`,
     base-character-model.mjs:1753) and how much HP a full night's rest
     restores (`onRestUpdate()`, base-character-model.mjs:1449) both
     multiply directly by `attributes.hd.total` — both would have been
     silently doubled under lockstep leveling without this fix. They're
     now correct (CON applies once per character level, as intended; rest
     heals one character level's worth of HD, not two).
   - `feats.mjs`'s "core" computation reads `attributes.hd.total` too, and
     runs after this fix by hook-registration order in `module.mjs`, so it
     already sees the corrected value — no change was needed there beyond
     updating its comment.
   - Still worth a live sanity check: any OTHER pf1 formula or third-party
     content keyed to `@attributes.hd.total`/`@details.level.value` (CR,
     XP tables, exotic caster-level formulas) should now see the correct,
     undoubled value automatically — confirm on a real dual-class actor
     rather than assuming.

5. **Skill-point pool panel is advisory/approximate, not an authoritative
   ledger.** pf1 has no concept of "which pool paid for which rank," so the
   panel pairs each ability's career-total points against ranks currently
   in skills that ability governs, rather than computing a single
   "remaining" number. This is a deliberate scope decision (see the plan),
   not a bug — but make sure players understand it's a sanity-check display,
   not a spend-tracker.

6. **Animal companion removal (Nature Bond / Hunter's Bond overrides) not
   yet loaded in a live world.** Both `nature-bond.eLyNatureBond001.yaml`
   and `hunter-s-bond.eLyHunterBond001.yaml` were written by hand-trimming
   core pf1's compound "choose domain-or-companion" / "choose ally-bond-or-
   companion" text down to the single retained branch — cross-checked
   against `RefCode/` source but never rendered on an actual class item.
   **Test**: build a Druid and a Ranger from this module's class overrides,
   confirm each grants the Elyndor bond variant (no companion option shown)
   at the expected level, and confirm a vanilla (non-overridden) Druid/Ranger
   still offers the real companion choice — isolating the change to this
   module rather than a global pf1 effect.

7. **RESOLVED (verified live) — Skill Bonus Conversion (§2.3).** Both
   halves confirmed live on 2026-09-09 against the `pf1e-test-bed` world
   (see the plan's "Phase 8 Spike Progress" section for the raw hook
   findings). Live results, all against a cloned (never persisted) copy
   of the Fighter+Sorc test actor:
   - A skill with only its native +3 "Class Skill" bonus (total 3, tier
     2-5): `mod` correctly reads with a flat **+2** replacing it — no
     "Class Skill" line left in the tooltip, no phantom cancelling entry.
   - The same skill plus a temporary +4 enhancement bonus (total 7, tier
     6-10): **no flat bonus** applied, and rolling the skill for real
     (`actor.rollSkill`) produced a genuine `2d20kh1` roll — confirmed via
     the actual outgoing chat payload, two real die results, correct one
     discarded.
   - The same skill plus a temporary +8 insight bonus (total 11, tier
     11+): **both** the flat +2 and Advantage applied together.
   - A different skill with only a lone +1 trait bonus (total 1, below
     the table's floor): left **completely untouched** — still shows its
     native +1, nothing suppressed, nothing converted.
   - **A genuine timing bug was caught and fixed during this verification,
     not just a naming mismatch**: the first implementation suppressed
     Changes by deleting them from `actor.changes` during
     `pf1AddDefaultChanges`, which looked right in isolation but silently
     failed — live-diffing `actor.changes`'s contents before/after that
     hook showed every entry gets a brand-new `_id` afterward, meaning the
     whole Collection is discarded and rebuilt from items again later, so
     the deletion never stuck (confirmed live: the suppressed Changes
     still doubled up in the final `mod`). Fixed by moving suppression
     into a `_prepareTypeChanges` wrap instead — the same method
     `saves-bab-lag.mjs` already wraps for save suppression, and the point
     at which the Changes array is actually near-final. See
     `changes/skill-bonus-conversion.mjs`'s header for the full writeup.
   - **Also confirmed through the real UI**, not just console/clone JSON
     checks: set a real rank on the persisted test actor's Bluff (native
     Class Skill +3 alone, tier 2-5), opened its actual character sheet,
     and hovered the Skills-tab tooltip — clean breakdown (`Skill Ranks
     +1`, `Skill Bonus Conversion (Elyndor) +2`, `Charisma +2`), no
     "Class Skill" line. Added a real temporary +8 insight item (total 11,
     tier 11+) and confirmed the same clean tooltip, no "Temp Insight"
     line either. Then clicked the sheet's own Bluff roll icon for a real
     roll through the dialog: the chat card expands to show `2d20kh1`,
     both die results (4 discarded, 16 kept), and the identical clean
     source breakdown, total 16+1+2+2=21. All scratch state (temp item,
     rank, chat message) was removed afterward, leaving the actor as
     found.
   - **Not yet handled**: subskills (Craft/Profession/Perform instances)
     use a different Change-target shape than the fixed base-skill list
     this file walks — skipped silently for now, unverified.
   - **CRITICAL CORRECTION (session of 2026-09-09, found via a real user
     bug report, not another automated pass) — the feature above didn't
     actually work in real play**, despite every verification bullet above
     genuinely passing. Two separate bugs, both now fixed:
     1. **A skill bonus applied via a Change targeting ALL skills at once
        (`target: "skills"`, plural — the same mechanism pf1's own native
        "Wound Threshold"/"Negative Levels" penalties use, and a natural
        choice when authoring a Buff through the Change editor) was never
        detected at all** — every verification pass above happened to use
        a skill-*specific* target (`skill.~<id>`), which the original code
        exclusively matched. Fixed by unrolling any `target: "skills"`
        Change into one independent clone per skill before the per-skill
        pass runs (`unrollGlobalSkillChanges` in
        `changes/skill-bonus-conversion.mjs`) — a global bonus can't be
        suppressed in place the way a skill-specific one is, since
        deleting the single shared Change would silently remove it from
        every OTHER skill's total too.
     2. **Far more serious: the suppression wrap was registered from the
        wrong hook and silently never took effect in real play at all**,
        global-target bug or not. It was registered from `Hooks.once("setup")`
        — matching this module's usual rule that anything touching
        `pf1.config`/`pf1.applications` needs "setup", since "init" is too
        early for those. But this wrap only touches `CONFIG.Actor.*`,
        available even at "init" — and `_prepareTypeChanges` (confirmed
        live) is NOT part of the normal per-render prepare cycle: for a
        given actor it effectively runs once, very early — before "setup"
        fires — and its result is then cached. Neither a fresh page load
        nor opening the actor sheet ever re-triggers it; only an explicit
        `actor.reset()+prepareData()` does. Every manual verification
        above used exactly that pattern (or created/deleted a test item,
        which has the same effect) without realizing it was the only
        reason the fix appeared to work — in genuinely untouched real
        play, the wrap installed itself *after* that one early call had
        already happened and been cached, so every skill bonus kept
        applying at its raw, unconverted value, every time, for every
        character. Fixed by moving the registration to `Hooks.once("init")`,
        alongside `registerSecondaryBabSuppression` (which wraps the same
        method, from the same hook, and was the live proof this earlier
        timing actually works). **Re-verified after the fix on two
        separate genuinely fresh page loads** (full reload, join, first
        read immediately on `ready`, zero prior actor interaction) — both
        `actor.system.skills.dip.mod` and the actual rendered Skills-tab
        tooltip on the persisted test actor now read correctly on the very
        first check.
     - **Lesson for future verification passes in this module**: a
       suppression wrap's live-verified correctness has to be checked
       against a **cold, untouched load** — a manual `actor.reset()` or
       any item create/delete before checking can mask exactly this class
       of registration-timing bug.

8. **RESOLVED (verified live) — the roll dialog's own "Situational Bonus"
   field bypassed §2.3 entirely.** A second real user bug report (session
   of 2026-09-09, same day as #7): typing a plain "+5" into the Roll Skill
   Check dialog's "Situational Bonus" field applied it as a raw,
   unconverted modifier — every persistent Change was suppressed and
   converted correctly, but this one roll-time input path was never
   touched by any of it. Root cause: that field's value never becomes a
   Change at all — it's appended directly to the roll's own term list,
   entirely outside `actor.changes`/`_prepareTypeChanges` (confirmed live:
   `options.parts`, the same array every tracked persistent contributor
   flows through, never contains it). Fixed in `handlePreD20Roll`: every
   tracked contributor's `NumericTerm` always carries a non-empty
   `flavor` (verified live across every skill/Change combination this
   module has ever tested), so an *unflavored* numeric term is the one
   reliable signal a term came from the dialog instead. When found, its
   value is combined with the skill's cached persistent total (now cached
   per-skill on the actor alongside the existing Advantage set) and the
   whole thing is reconverted for that roll only — never written back to
   the sheet.
   - **A second, sharper bug was caught during THIS fix's own
     verification** (not a leftover from #7): the first version of the
     roll-time fold only stripped a *stale flat conversion term* before
     inserting the freshly-recomputed one — it left any *raw, still-
     unconverted* persistent contributor (e.g. a global buff whose
     persistent total alone was below the table's floor) sitting in the
     roll, where it then double-counted alongside the newly-added flat
     bonus once the situational addition pushed the combined total over
     the floor. Live-caught via the exact repro: Acrobatics with a
     persisted `RadicalTestBuff` (+1, below floor, so applying raw) plus
     a `+12` situational bonus produced `1d20 + 1[Dexterity] +
     1[RadicalTestBuff] + 2[Skill Bonus Conversion (Elyndor)]` — the
     `RadicalTestBuff` term should not have survived. Fixed by rebuilding
     `roll.terms` from scratch on every fold (`recombineSkillRoll`)
     instead of splicing specific indices: every term whose flavor is one
     of the skill's own cached §2.3-relevant flavors (not just the flat
     conversion term) is dropped, alongside the raw situational term(s),
     before the fresh flat term (if any) is appended. Re-verified live
     after this fix: same repro now correctly produces `2d20kh1 +
     1[Dexterity] + 2[Skill Bonus Conversion (Elyndor)]`, total 16, no
     leftover `RadicalTestBuff` line.
   - Also verified live in the same pass: a plain roll with no situational
     input is completely unaffected (byte-identical formula to before this
     fix existed); a dice-based situational bonus (e.g. `1d6`, which the
     field's own placeholder documents as supported) is left completely
     untouched rather than mishandled — there's nothing to statically
     convert before dice are rolled, and a flavored sub-part of a mixed
     formula (`2[Aid]`) would be indistinguishable from a real tracked
     Change, so this is an explicit, documented scope boundary rather
     than a gap: only a bare, dice-free numeric situational entry folds
     into the conversion.

9. **FIXED (not yet live-verified) — single-class actors (e.g. a race that
   locks in one class outright) got vanilla pf1 skill points instead of
   §2.2's ability-pool formula.** `applySkillPointsChange` and
   `suppressNativeClassSkillRanks` (`changes/skill-points-total.mjs`) both
   required a Primary *and* a Secondary class role to be assigned before
   doing anything; a character with only one class item never goes through
   the Primary/Secondary toggle at all (there's no choice to make), so both
   functions silently no-op'd — the six-pool bonus was never added, and
   pf1's native per-class `(skillsPerLevel + intMod) × HD` formula was never
   suppressed either. `getPrimaryClass()` (`class-roles.mjs`) now falls back
   to treating an actor's sole, unflagged class item as Primary; Secondary
   is now optional (not required) in both functions above, so a single-class
   actor gets the §2.2 formula same as a dual-class one. This also fixes
   `feats.mjs`'s §4.1 feat-count rule for the same actors, which only ever
   needed Primary and inherits the same fallback. A Quench test case
   (`test/dual-class.test.mjs`, "Single-class actor") covers this but has
   not been run live — **Test**: build a single-class test actor (no role
   toggled), confirm the Skills tab's "Skill Ranks" total matches the §2.2
   pool sum (not the core class-skill-points formula) and feat count is
   1/character-level.

## Dev setup

Per `RefCode/docs/other/MODULE_DEV.md`: symlink the `pf1` system repo
alongside this module and reference it in `jsconfig.json`/`tsconfig.json`
for type hints. This module intentionally imports nothing from `pf1`'s own
source — only the documented `globalThis.pf1` API and Foundry core hooks —
per `RefCode/docs/API.md`'s "never import pf1 system JS files" guidance.

## Compendium ID scheme

All items in `packs-source/` use hand-assigned ids prefixed `eLy...`
(exactly 16 chars, Foundry's hard id-length requirement) rather than
randomly generated ones, so they're stable and greppable across edits.

**Verified live, and fixed**: five ids (`eLyClericCls001`, `eLyRogueCls0001`,
`eLyPaladinCls01`, `eLyRangerCls001`, `eLyFavTerr0001`) were originally only
14-15 chars. Confirmed live that Foundry does **not** reject or pad a
short `_id` — it silently loads the document with `_id: null` instead,
which made the affected items show up as visually-identical, unselectable
duplicates in the compendium browser (e.g. two indistinguishable
"Rogue (Elyndor)" entries). All five were padded to 16 characters
(and the one cross-reference — `ranger`'s `links.supplements` entry
pointing at Favored Terrain's id — updated to match) and recompiled;
`pack.getDocuments()` now shows exactly 8 items in `elyndor-classes`, each
with a valid, non-null 16-character id. **Any new item added to `packs-source/`
in the future must have a `_id` of exactly 16 characters, or it will
silently break the same way.**

`_key` fields follow pf1's own `!items!<id>` convention. Full flavor-text
descriptions are intentionally **not** duplicated from pf1's core
compendium entries where this module only changes a mechanical field (e.g.
Dwarf's speed) — each override's description instead summarizes the
house-rule change and points at the corresponding `RefCode/packs/**/*.yaml`
source for the complete original text, to avoid maintaining two copies of
the same multi-paragraph content.
