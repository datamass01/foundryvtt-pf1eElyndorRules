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
 *
 * TOOLTIP BREAKDOWN: rather than pushing that correction as a single lump
 * Change, this is split into one flavored Change per ability pool (plus the
 * flat bonus) so the Skills-tab "Skill Ranks" tooltip
 * (base-character-sheet.mjs's `case "skills"`, which reads
 * `actor.getSourceDetails("system.details.skills.bonus")`) shows where
 * every point actually comes from under §2.2's six-ability-pool formula —
 * not just the Intelligence line vanilla pf1 already shows for its own
 * (now-superseded) per-class formula. Because pf1's native per-class
 * formula is baked directly into its skill totals (not something this
 * module can suppress), its result is cancelled with one clearly-labeled
 * negative offset Change instead of trying to net it into any one ability's
 * line — a per-ability net would misattribute part of the class base to
 * whichever ability absorbed the difference.
 *
 * KNOWN COSMETIC QUIRK (verified live): pf1's own tooltip code
 * (base-character-sheet.mjs's `case "skills"`) does NOT read this
 * `coreContribution` value — it hand-rolls its own approximation for
 * display, showing each class's `skillsPerLevel * hitDice` plus ONE shared
 * `intMod * attributes.hd.total` line. Because `changes/character-level.mjs`
 * intentionally shrinks `hd.total` down to true character level (fixing HP
 * and rest-healing doubling), that shared line ends up using a smaller
 * `hd.total` than the per-class formula actually earned, so pf1's own
 * displayed lines under-count by `intMod * secondary.hitDice` versus what
 * `coreContribution` (and the real skill-point total) actually is — e.g. a
 * dual-classed character with a +1 Int mod will see the visible native
 * lines sum to 5 less than what this file's `-coreContribution` line
 * actually cancels. This is a pre-existing display-only quirk in pf1's own
 * (uneditable from here) tooltip formula, not something introduced by this
 * offset — the real total this Change list produces is correct and matches
 * `desiredTotal` exactly (verified live). Reproducing that formula here to
 * "fix" the visible native lines would couple this module to pf1's private
 * display logic (the same RefCode-vs-shipped-build drift risk flagged
 * throughout this module), so it's left as a known, harmless cosmetic
 * mismatch.
 */
import { getPrimaryClass, getSecondaryClass } from "../class-roles.mjs";
import { skillPointPools, POOL_ABILITIES, FLAT_SKILL_POINTS_PER_LEVEL } from "../lib/formulas.mjs";

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

  const pools = skillPointPools(actor);

  const pushRanks = (value, flavor) => {
    if (!value) return; // Skip zero-value lines (e.g. a 0 ability modifier), matching pf1's own `if (intMod !== 0)` guard for its native Intelligence line.
    changes.push(
      new pf1.components.ItemChange({
        formula: String(value),
        operator: "add",
        target: "bonusSkillRanks",
        type: "untyped",
        flavor,
      }),
    );
  };

  // pf1.config.abilities[id] is already a resolved display string at
  // runtime (pf1 localizes its own config in its "setup" hook) — same
  // pattern already used for the second-save Changes in saves-bab-lag.mjs
  // and the land-speed Change in movement.mjs.
  for (const abilityId of POOL_ABILITIES) {
    pushRanks(pools[abilityId] * characterLevel, pf1.config.abilities[abilityId]);
  }
  pushRanks(
    FLAT_SKILL_POINTS_PER_LEVEL * characterLevel,
    game.i18n?.localize?.("ELYNDOR.SkillPools.Flat") ?? "Generic (flat)",
  );

  // Cancel pf1's own native per-class formula (visible in that same tooltip
  // as each class's "Class Base" line plus its own separate Intelligence
  // line) so it doesn't stack with the ability-pool total pushed above —
  // this Change wholesale replaces it, it doesn't adjust it.
  pushRanks(
    -coreContribution,
    game.i18n?.localize?.("ELYNDOR.SkillPools.FormulaOffset") ?? "Elyndor Skill Formula (replaces class base)",
  );
}
