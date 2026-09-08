/**
 * House rules implemented here:
 *  - §1.4 BAB: Primary Class only (Secondary contributes 0 BAB).
 *  - §3.1 Base save = max(Primary @ own level, Secondary @ own level - 2).
 *  - §3.2 Doubled save-ability modifiers (Fort+STR, Ref+INT, Will+CHA on
 *    top of pf1's existing Fort+CON/Ref+DEX/Will+WIS).
 *
 * All pushed via the documented `pf1.change.defaults` hook
 * (module/hooks.d.ts:518-532 in RefCode), which hands the listener a fresh
 * array that gets concatenated onto the actor's real Change list — i.e. we
 * can only ADD Changes here, never remove/replace pf1's own. Every rule
 * below is therefore expressed as an additive delta against a value pf1
 * already computed, not as a rewrite of it. `bab` and the save targets are
 * all `untyped`/`untypedPerm` bonus types (verified in
 * `pf1.config.stackingBonusTypes`), which stack rather than "highest wins",
 * so an additive delta lands correctly without double-counting.
 *
 * NOT YET VERIFIED IN A LIVE FOUNDRY+pf1 WORLD (see
 * Docs/house-rules and the plan's "Spike" section): the save-lag delta's
 * interaction with the "Fractional Base Bonuses" world setting
 * (`pf1.settings.fractional`) in particular needs a live check before this
 * is trusted at the table, per the plan's own exit criteria.
 */
import { getPrimaryClass, getSecondaryClass, laggedLevel } from "../class-roles.mjs";
import { maxSaveDelta } from "../lib/formulas.mjs";

/** Second ability added to each save, on top of pf1's existing default. */
const SECOND_SAVE_ABILITY = /** @type {const} */ ({
  fort: "str",
  ref: "int",
  will: "cha",
});

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applySavesAndBabChanges(actor, changes) {
  // §3.2 — always applies, independent of the Primary/Secondary structure.
  for (const [saveId, ability] of Object.entries(SECOND_SAVE_ABILITY)) {
    changes.push(
      new pf1.components.ItemChange({
        formula: `@abilities.${ability}.mod`,
        operator: "add",
        target: saveId,
        type: "untypedPerm",
      }),
    );
  }

  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return; // No dual-class structure set up (yet) on this actor.

  // §1.4 — cancel out whatever BAB the Secondary class's own progression
  // would otherwise contribute.
  const babDelta = -(secondary.system.babBase ?? 0);
  if (babDelta !== 0) {
    changes.push(
      new pf1.components.ItemChange({
        formula: String(babDelta),
        operator: "add",
        target: "bab",
        type: "untyped",
      }),
    );
  }

  // §3.1 — pf1 core sums Primary's and Secondary's base save contributions
  // (standard PF1 multiclassing). The house rule wants the TOTAL to be
  // max(primary.base, secondary.base @ level-2) instead, so the delta
  // cancels the sum down to that max — see maxSaveDelta() for the derivation.
  const lagged = laggedLevel(secondary.system.level);
  for (const saveId of Object.keys(SECOND_SAVE_ABILITY)) {
    const delta = maxSaveDelta(primary, secondary, saveId, lagged);
    if (delta !== 0) {
      changes.push(
        new pf1.components.ItemChange({
          formula: String(delta),
          operator: "add",
          target: saveId,
          type: "untyped",
        }),
      );
    }
  }
}
