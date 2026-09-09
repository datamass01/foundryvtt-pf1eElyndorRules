/**
 * §2.2 — aggregate skill-point total (the per-attribute *pool restriction*
 * itself is a separate, UI-level concern — see ui/skill-pool-panel.mjs).
 *
 * This has two halves, both required for the Skills tab's "Skill Ranks"
 * total (base-character-sheet.mjs `skillRanks.allowed`) to read correctly:
 *
 *  1. `applySkillPointsChange` ADDS one flavored `bonusSkillRanks` Change
 *     per ability pool (plus the flat bonus) so the total — and the
 *     Skills-tab tooltip (`case "skills"`, reading
 *     `actor.getSourceDetails("system.details.skills.bonus")`) — reflects
 *     §2.2's six-ability-pool formula instead of pf1's own per-class one.
 *  2. `registerSkillRankSuppression` SUPPRESSES pf1's own native per-class
 *     formula at its source (see below) so it doesn't stack with #1.
 *
 * WHY NOT A CANCELLING CHANGE (previous approach, replaced):
 * pf1's native per-class skill formula is computed directly inside the
 * character sheet's `_prepareSkills` (`Math.max(1, skillsPerLevel + intMod)
 * * hitDice`, summed per class) — it is NOT itself a Change, so there is
 * nothing to intercept or remove from `actor.changes`. The only way to
 * cancel it from the Change list is to add a same-sized NEGATIVE Change on
 * top, which is exactly what this file used to do (one lump
 * `-coreContribution` line flavored "Elyndor Skill Formula (replaces class
 * base)"). That worked arithmetically but showed a negative number in the
 * Skill Ranks tooltip — same complaint as the BAB/save tooltip fixed in
 * `saves-bab-lag.mjs`, and the same fix applies: suppress the unwanted
 * contribution at its actual source (post-hoc, after pf1 computes it) so
 * nothing needing cancellation is ever added to a tooltip-visible total in
 * the first place. See `registerSkillRankSuppression` below — the skills
 * equivalent of that file's `stripSecondaryBabFromActor`.
 *
 * WHY FORMULA-STRING CHANGES, NOT LITERAL NUMBERS (also new):
 * The previous version computed each pool's point value in plain JS at
 * `pf1AddDefaultChanges` time (`actor.system.abilities[id].mod`) and baked
 * that number into the Change's formula. But `pf1AddDefaultChanges` fires
 * to CONTRIBUTE Changes to the list *before* the full list — including any
 * item/buff Changes that themselves raise an ability score — has been
 * sorted and applied, so a plain JS read of `abilities.X.mod` at that point
 * can catch a not-yet-buffed value and bake the stale number in permanently
 * (verified live: a character with a Dex-boosting source had their Dex
 * pool silently undercounted by exactly that bonus). pf1's own core skill
 * Changes avoid this by using a formula string evaluated later in the same
 * pass (`@abilities.${ability}.mod`) with `priority: -10` so ability-buff
 * Changes (default priority) are guaranteed to run first — see
 * `base-character-model.mjs`'s `addSKillChanges`, whose own comment reads
 * "Stat buffing items don't work correctly without this". The pool
 * Changes below use that same pattern instead of a precomputed literal.
 *
 * `characterLevel`/`intMod` themselves are still read as plain JS (not
 * formula refs) since they're stable within a single actor at this point
 * and this matches every other file in this module (feats.mjs,
 * saves-bab-lag.mjs) — only ability *modifiers*, which can be altered by
 * still-pending Changes in the same pass, need the deferred-formula
 * treatment.
 *
 * IMPORTANT: like feats.mjs, this is computed against **character level**
 * (`primary.system.level`), not each class item's own `hitDice`. Under
 * lockstep leveling both class items report the same hitDice as
 * character level, so replicating pf1's own per-class formula with that
 * shared level value reproduces exactly what pf1 will independently
 * compute, letting the suppression in `registerSkillRankSuppression`
 * subtract precisely what pf1 added.
 */
import { getPrimaryClass, getSecondaryClass } from "../class-roles.mjs";
import { skillPointPools, POOL_ABILITIES, FLAT_SKILL_POINTS_PER_LEVEL } from "../lib/formulas.mjs";
import { wrapAfter } from "../lib/wrap.mjs";

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applySkillPointsChange(actor, changes) {
  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return; // Dual-class structure not set up yet on this actor.

  const characterLevel = primary.system.level ?? 0;

  const pushRanks = (formula, flavor, { deferred = false } = {}) => {
    changes.push(
      new pf1.components.ItemChange({
        formula,
        operator: "add",
        target: "bonusSkillRanks",
        type: "untyped",
        flavor,
        // Deferred (ability-mod-dependent) pools must be evaluated after
        // ability-buffing Changes (default priority) — see file header.
        ...(deferred ? { priority: -10 } : {}),
      }),
    );
  };

  // pf1.config.abilities[id] is already a resolved display string at
  // runtime (pf1 localizes its own config in its "setup" hook) — same
  // pattern already used for the second-save Changes in saves-bab-lag.mjs
  // and the land-speed Change in movement.mjs.
  for (const abilityId of POOL_ABILITIES) {
    pushRanks(`max(0, @abilities.${abilityId}.mod) * ${characterLevel}`, pf1.config.abilities[abilityId], {
      deferred: true,
    });
  }
  pushRanks(
    String(FLAT_SKILL_POINTS_PER_LEVEL * characterLevel),
    game.i18n?.localize?.("ELYNDOR.SkillPools.Flat") ?? "Generic (flat)",
  );
}

/**
 * Suppress pf1's own native per-class skill-rank formula at its source so
 * it never stacks with `applySkillPointsChange`'s ability-pool total — the
 * skills equivalent of `saves-bab-lag.mjs`'s `stripSecondaryBabFromActor`.
 *
 * Unlike BAB (where only the Secondary class's contribution is zeroed),
 * §2.2 replaces the per-class formula entirely, so BOTH Primary's and
 * Secondary's native contributions are subtracted here — Favored Class
 * Bonus into skills is untouched (§2.2 doesn't replace it; it's kept as
 * its own unrestricted source, folded into the skill-pool panel's Generic
 * row via `favoredClassSkillBonus` for parity — see ui/skill-pool-panel.mjs).
 *
 * pf1's native formula lives directly inside the character sheet's
 * `_prepareSkills(context)` (not a Change, so nothing to filter out of
 * `actor.changes` the way `pickHighestClassSaves` does for saves) — this
 * wraps that method and subtracts the exact same per-class term
 * (`Math.max(1, skillsPerLevel + intMod) * hitDice`) pf1 just added to
 * `context.skillRanks.allowed`, replicated line-for-line against the
 * installed v11.11 build (verified against the shipped `pf1.js` bundle,
 * which matches RefCode's `_prepareSkills` here — unlike some other hooks
 * in this module, no drift found for this particular method).
 */
export function registerSkillRankSuppression() {
  const SheetClass = pf1?.applications?.actor?.ActorSheetPFCharacter;
  if (!SheetClass?.prototype) return;

  wrapAfter(SheetClass.prototype, "_prepareSkills", function (context) {
    suppressNativeClassSkillRanks(this.actor ?? this.document, context);
  });
}

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {object} context - The same context object pf1's `_prepareSkills`
 *   just finished mutating (`context.skillRanks.allowed` included).
 */
function suppressNativeClassSkillRanks(actor, context) {
  const skillRanks = context?.skillRanks;
  if (!skillRanks) return;

  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return; // Dual-class structure not set up yet on this actor.

  // Same isMindless/intMod derivation pf1's own `_prepareSkills` just used
  // on this same `context`, so the subtraction matches its addition exactly.
  const abilities = context.system?.abilities;
  const isMindless = abilities?.int?.value === null;
  const intMod = isMindless ? 0 : (abilities?.int?.mod ?? 0);
  if (isMindless) return; // pf1 adds nothing but FCB for mindless creatures; nothing to subtract.

  let nativeContribution = 0;
  for (const cls of [primary, secondary]) {
    const hd = cls.system.hitDice;
    if (!hd) continue;
    const perLevel = cls.system.skillsPerLevel || 0;
    nativeContribution += Math.max(1, perLevel + intMod) * hd;
  }

  skillRanks.allowed -= nativeContribution;
}

/**
 * Strip pf1's own native per-class "Class Base" and Intelligence lines from
 * the Skills-tab hover tooltip so they don't linger as phantom entries now
 * that `registerSkillRankSuppression` above zeroes their contribution to
 * the total (verified live on a level-3 dual-class character: without
 * this, the tooltip's visible lines summed to 60 against a real,
 * correctly-computed "Skill Ranks" total of 48 — the leftover 12 being
 * exactly `Inquisitor (Base)` + `Arcanist (Base)` + the native
 * Intelligence line this strips).
 *
 * `suppressNativeClassSkillRanks` only trims `context.skillRanks.allowed`
 * inside `_prepareSkills` — the hover tooltip is a *separate* pass
 * (`_getTooltipContext`, called on hover, not during sheet render) that
 * rebuilds its own display-only per-class breakdown from scratch and was
 * never touched by that suppression, so the two drifted out of sync.
 *
 * Only targets `"skills.adventure"` (the pool this house rule replaces);
 * `"skills.background"` is an unrelated, untouched pf1 mechanic.
 *
 * Favored Class Bonus lines (`"{class} (Favoured Class)"`) are §2.2-exempt
 * (see `favoredClassSkillBonus` in lib/formulas.mjs) and deliberately left
 * alone — only lines ending in the installed build's actual
 * `SourceInfoSkillRank_ClassBase` suffix ("(Base)") and the unlabeled
 * native Intelligence line (matched against `pf1.config.abilities.int`,
 * already a resolved display string — same pattern as
 * `applySkillPointsChange`'s flavors) are removed.
 *
 * CORRECTION (verified live): RefCode's `base-character-sheet.mjs` builds
 * these lines via `_loc("PF1.SourceInfo.Class.Base"/"PF1.AbilityScores.int.Label")`,
 * but neither key exists in the installed v11.11 build's actual lang file —
 * its real keys are `PF1.SourceInfoSkillRank_ClassBase`/
 * `PF1.SourceInfoSkillRank_ClassFC`, and there is no working key at all for
 * the bare ability label (it resolves to the literal key string), which is
 * why this matches against `pf1.config.abilities.int` instead — same family
 * of RefCode-vs-shipped-build drift flagged throughout this module.
 */
export function registerSkillTooltipCleanup() {
  const SheetClass = pf1?.applications?.actor?.ActorSheetPFCharacter;
  if (!SheetClass?.prototype) return;

  // `_getTooltipContext` is declared `async`, but its "skills" branch (the
  // one below) never actually awaits anything, so it runs to completion
  // synchronously before returning its (already-resolved) Promise — safe
  // to inspect/mutate `context` right after calling it, same as every
  // other `wrapAfter` use in this module.
  wrapAfter(SheetClass.prototype, "_getTooltipContext", function (fullId, context) {
    if (fullId !== "skills.adventure") return;
    stripNativeSkillTooltipLines(context);
  });
}

/**
 * @param {object} context - The tooltip context `_getTooltipContext` just
 *   finished mutating — `context.sources` is `[oursGroup, nativeGroup]`
 *   for the "skills" case (see base-character-sheet.mjs's `case "skills"`:
 *   it pushes `getSourceDetails(...)` first, then its own `skillSources`).
 */
function stripNativeSkillTooltipLines(context) {
  const nativeGroup = context?.sources?.[1];
  if (!Array.isArray(nativeGroup?.sources)) return;

  const classBaseSuffix = game.i18n
    .localize("PF1.SourceInfoSkillRank_ClassBase")
    .replace("{className}", "")
    .trim();
  const intLabel = pf1.config.abilities.int;

  nativeGroup.sources = nativeGroup.sources.filter(
    (entry) => !entry.name?.endsWith(classBaseSuffix) && entry.name !== intLabel,
  );
}
