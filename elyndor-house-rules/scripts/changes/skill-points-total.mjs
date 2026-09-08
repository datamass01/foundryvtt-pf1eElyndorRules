/**
 * §2.2 — aggregate skill-point total (the per-attribute *pool restriction*
 * itself is a separate, UI-level concern — see ui/skill-pool-panel.mjs).
 *
 * pf1 computes skill points per class as
 * `Math.max(1, cls.system.skillsPerLevel + intMod) * cls.system.hitDice`,
 * summed across every class item, and reads the result (plus
 * `system.details.skills.bonus`, the `bonusSkillRanks` Change target) in
 * BOTH the actor sheet's Skills tab (base-character-sheet.mjs) and the
 * guided Level-Up wizard (level-up.mjs) — so a single delta pushed onto
 * `bonusSkillRanks` here corrects the total in both places natively, no
 * sheet/wizard code changes needed.
 *
 * IMPORTANT: like feats.mjs, this is computed against **character level**
 * (`primary.system.level`), not each class item's own `hitDice`. Under
 * lockstep leveling both class items report the same hitDice as
 * character level, so replicating pf1's own per-class formula with that
 * shared level value reproduces exactly what pf1 will independently
 * compute, letting the delta cancel it precisely.
 */
import { getPrimaryClass, getSecondaryClass } from "../class-roles.mjs";
import { totalSkillPointsPerLevel } from "../lib/formulas.mjs";

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applySkillPointsChange(actor, changes) {
  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return; // Dual-class structure not set up yet on this actor.

  const characterLevel = primary.system.level ?? 0;
  const intMod = actor.system.abilities?.int?.mod ?? 0;

  const perClassCore = (cls) => Math.max(1, (cls.system.skillsPerLevel ?? 0) + intMod) * characterLevel;
  const coreContribution = perClassCore(primary) + perClassCore(secondary);

  const desiredTotal = totalSkillPointsPerLevel(actor) * characterLevel;
  const delta = desiredTotal - coreContribution;

  if (delta !== 0) {
    changes.push(
      new pf1.components.ItemChange({
        formula: String(delta),
        operator: "add",
        target: "bonusSkillRanks",
        type: "untyped",
      }),
    );
  }
}
