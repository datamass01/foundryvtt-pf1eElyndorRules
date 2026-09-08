/**
 * House rules implemented here:
 *  - §1.4 BAB: Primary Class only (Secondary contributes 0 BAB).
 *  - §3.1 Base save = max(Primary @ own level, Secondary @ own level - 2).
 *  - §3.2 Doubled save-ability modifiers (Fort+STR, Ref+INT, Will+CHA on
 *    top of pf1's existing Fort+CON/Ref+DEX/Will+WIS).
 *
 * Saves (§3.1/§3.2) are pushed via the documented `pf1.change.defaults` hook
 * (module/hooks.d.ts:518-532 in RefCode), which hands the listener a fresh
 * array that gets concatenated onto the actor's real Change list — i.e. we
 * can only ADD Changes there, never remove/replace pf1's own. Save rules
 * are therefore expressed as an additive delta against a value pf1 already
 * computed. Save targets are `untyped`/`untypedPerm` bonus types (verified
 * in `pf1.config.stackingBonusTypes`), which stack rather than "highest
 * wins", so an additive delta lands correctly without double-counting.
 *
 * BAB (§1.4) cannot use that additive-cancel pattern: a negative Change
 * stacked on the Secondary class's own positive contribution shows up as
 * both a + and a − modifier. Instead `registerSecondaryBabSuppression()`
 * zeroes the Secondary class's computed `babBase` so pf1 never awards it.
 *
 * Installed pf1 v11.11 (verified against the shipped `pf1.js` bundle, which
 * differs from RefCode): `ItemClassPF#prepareDerivedData` writes `babBase`,
 * then `ActorPF#prepareBaseData` sums every class's `babBase` into
 * `attributes.bab.total` and records a positive sourceInfo entry per class.
 * Wrapping `prepareBaseData` on the class data model is too early — v11.11
 * overwrites `babBase` in `prepareDerivedData` after that. The wrap below
 * therefore hits `ItemClassPF#prepareDerivedData` (and the matching RefCode
 * TypeDataModel methods) plus a cleanup pass on `ActorPF#prepareBaseData`.
 *
 * NOT YET VERIFIED IN A LIVE FOUNDRY+pf1 WORLD (see
 * Docs/house-rules and the plan's "Spike" section): the save-lag delta's
 * interaction with the "Fractional Base Bonuses" world setting
 * (`pf1.settings.fractional`) in particular needs a live check before this
 * is trusted at the table, per the plan's own exit criteria.
 */
import { getPrimaryClass, getSecondaryClass, isSecondaryClass, laggedLevel } from "../class-roles.mjs";
import { maxSaveDelta } from "../lib/formulas.mjs";

/** Second ability added to each save, on top of pf1's existing default. */
const SECOND_SAVE_ABILITY = /** @type {const} */ ({
  fort: "str",
  ref: "int",
  will: "cha",
});

/**
 * Call `after` once the original method returns. Assigns an own property
 * on `proto` so inherited methods on a parent class are left intact.
 *
 * @param {object} proto
 * @param {string} method
 * @param {(this: object, ...args: unknown[]) => void} after
 */
function wrapAfter(proto, method, after) {
  const original = proto?.[method];
  if (typeof original !== "function") return;
  proto[method] = function (...args) {
    const result = original.apply(this, args);
    after.call(this, ...args);
    return result;
  };
}

/**
 * Walk the prototype chain from `start` and wrap the first own `method`.
 *
 * @param {object} start
 * @param {string} method
 * @param {(this: object, ...args: unknown[]) => void} after
 */
function wrapOwnAfter(start, method, after) {
  let proto = start;
  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, method)) {
      wrapAfter(proto, method, after);
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }
}

/**
 * §1.4 — Secondary class awards no BAB.
 *
 * Must run after pf1 has registered its item/actor document classes
 * (system `init`). See the file header for why this is a prototype wrap
 * rather than an additive cancel Change.
 */
export function registerSecondaryBabSuppression() {
  // v11.11: ItemClassPF.prepareDerivedData is where babBase is computed.
  const ItemClassPF = CONFIG.Item.documentClasses?.class;
  if (ItemClassPF?.prototype) {
    wrapAfter(ItemClassPF.prototype, "prepareDerivedData", function () {
      suppressSecondaryClassBab(this);
    });
  }

  // RefCode / TypeDataModel path (not used by the installed v11.11 build,
  // but the same house rule if the world is ever upgraded).
  const ClassModel = CONFIG.Item.dataModels?.class;
  if (ClassModel?.prototype) {
    wrapAfter(ClassModel.prototype, "prepareBaseData", function () {
      suppressSecondaryClassBab(this.parent);
    });
    const originalPrep = ClassModel.prototype._prepareChanges;
    if (typeof originalPrep === "function") {
      ClassModel.prototype._prepareChanges = function (...args) {
        if (isSecondaryClass(this.parent)) {
          this.babBase = 0;
          return;
        }
        return originalPrep.apply(this, args);
      };
    }
  }

  // v11.11 ActorPF.prepareBaseData sums class babBase into the actor total
  // and records sourceInfo. Clean up after that sum so a missed item wrap
  // cannot leak Secondary BAB into the total or the tooltip.
  const Character = CONFIG.Actor.documentClasses?.character;
  if (Character?.prototype) {
    wrapOwnAfter(Character.prototype, "prepareBaseData", function () {
      stripSecondaryBabFromActor(this);
    });
  }
}

/**
 * @param {pf1.documents.ItemPF} item
 */
function suppressSecondaryClassBab(item) {
  if (item?.type !== "class") return;
  if (!isSecondaryClass(item)) return;
  if (item.system) item.system.babBase = 0;
}

/**
 * @param {pf1.documents.ActorPF} actor
 */
function stripSecondaryBabFromActor(actor) {
  const secondary = getSecondaryClass(actor);
  if (!secondary) return;

  const path = "system.attributes.bab.total";
  const groups = actor.sourceInfo?.[path];
  if (groups?.positive) {
    groups.positive = groups.positive.filter((entry) => entry.name !== secondary.name);
  }

  const contributed = Number(secondary.system?.babBase) || 0;
  if (contributed) {
    const bab = actor.system.attributes?.bab;
    if (bab) bab.total = (bab.total ?? 0) - contributed;
    secondary.system.babBase = 0;
  }
}

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applySavesAndBabChanges(actor, changes) {
  // §3.2 — always applies, independent of the Primary/Secondary structure.
  // `flavor` is required: parentless ItemChanges fall back to `type` in
  // prepareData(), which made these show as "untypedPerm" in the save
  // source tooltip. Same pattern as pf1's own CON/DEX/WIS-to-save Changes.
  for (const [saveId, ability] of Object.entries(SECOND_SAVE_ABILITY)) {
    changes.push(
      new pf1.components.ItemChange({
        formula: `@abilities.${ability}.mod`,
        operator: "add",
        target: saveId,
        type: "untypedPerm",
        flavor: pf1.config.abilities[ability],
      }),
    );
  }

  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return; // No dual-class structure set up (yet) on this actor.

  // §1.4 BAB is handled by registerSecondaryBabSuppression() (zeroes
  // Secondary babBase during item prep), not by a canceling Change here.

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
