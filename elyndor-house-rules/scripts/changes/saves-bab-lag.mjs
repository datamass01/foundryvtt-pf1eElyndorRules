/**
 * House rules implemented here:
 *  - §1.4 BAB: Primary Class only (Secondary contributes 0 BAB).
 *  - §3.1 Base save = max(Primary @ own level, Secondary @ own level - 2).
 *  - §3.2 Doubled save-ability modifiers (Fort+STR, Ref+INT, Will+CHA on
 *    top of pf1's existing Fort+CON/Ref+DEX/Will+WIS).
 *
 * BAB (§1.4) and base saves (§3.1) cannot use an additive-cancel Change:
 * a negative Change stacked on the Secondary class's own positive
 * contribution shows up as both a + and a − modifier. Instead:
 *
 *  - Secondary `babBase` is zeroed at the source so pf1 never awards it.
 *  - Secondary save bases are rewritten to the lagged (level − 2) table,
 *    then pf1's per-class save Changes are filtered so only the higher of
 *    Primary vs lagged-Secondary remains — no add-then-subtract.
 *
 * Installed pf1 v11.11 (verified against the shipped `pf1.js` bundle, which
 * differs from RefCode): `ItemClassPF#prepareDerivedData` writes `babBase`
 * and `savingThrows[id].base`, then `ActorPF#prepareBaseData` sums every
 * class's `babBase` into `attributes.bab.total`. `BaseCharacterPF#_prepareTypeChanges`
 * later pushes one `untypedPerm` save Change per class (or one combined
 * "Base" Change when Fractional Base Bonuses is on). Wrapping
 * `prepareBaseData` on the class data model is too early — v11.11
 * overwrites those fields in `prepareDerivedData` after that.
 *
 * NOT YET VERIFIED IN A LIVE FOUNDRY+pf1 WORLD (see
 * Docs/house-rules and the plan's "Spike" section): the save-lag
 * interaction with the "Fractional Base Bonuses" world setting
 * (`pf1.settings.fractional`) in particular needs a live check before this
 * is trusted at the table, per the plan's own exit criteria.
 */
import { getPrimaryClass, getSecondaryClass, isSecondaryClass, laggedLevel } from "../class-roles.mjs";
import { compareDualClassSave, recomputeClassSaveAtLevel } from "../lib/formulas.mjs";

/** Fort / Ref / Will — same keys pf1 uses on class items and Change targets. */
const SAVE_IDS = /** @type {const} */ (["fort", "ref", "will"]);

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
 * §1.4 / §3.1 — Secondary class awards no BAB; its save bases use the
 * lagged table. Highest Primary vs lagged-Secondary save is selected
 * later in `_prepareTypeChanges`, not by cancelling a sum.
 *
 * Must run after pf1 has registered its item/actor document classes
 * (system `init`). See the file header for why this is a prototype wrap
 * rather than an additive cancel Change.
 */
export function registerSecondaryBabSuppression() {
  // v11.11: ItemClassPF.prepareDerivedData is where babBase and save
  // bases are computed.
  const ItemClassPF = CONFIG.Item.documentClasses?.class;
  if (ItemClassPF?.prototype) {
    wrapAfter(ItemClassPF.prototype, "prepareDerivedData", function () {
      applySecondaryClassPrep(this);
    });
  }

  // RefCode / TypeDataModel path (not used by the installed v11.11 build,
  // but the same house rule if the world is ever upgraded).
  const ClassModel = CONFIG.Item.dataModels?.class;
  if (ClassModel?.prototype) {
    wrapAfter(ClassModel.prototype, "prepareBaseData", function () {
      applySecondaryClassPrep(this.parent);
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
    // v11.11 BaseCharacterPF._prepareTypeChanges pushes one save Change
    // per class (or one combined "Base" Change when fractional). Drop the
    // losing class's contribution after that so the tooltip never shows
    // both a + and a −.
    wrapOwnAfter(Character.prototype, "_prepareTypeChanges", function (changes) {
      pickHighestClassSaves(this, changes);
    });
  }

  // RefCode: class save Changes are pushed from the actor data model's
  // `_prepareChanges`, not `_prepareTypeChanges`.
  const CharacterModel = CONFIG.Actor.dataModels?.character;
  if (CharacterModel?.prototype) {
    wrapOwnAfter(CharacterModel.prototype, "_prepareChanges", function (changes) {
      pickHighestClassSaves(this.parent, changes);
    });
  }
}

/**
 * @param {pf1.documents.ItemPF} item
 */
function applySecondaryClassPrep(item) {
  if (item?.type !== "class") return;
  if (!isSecondaryClass(item)) return;
  if (!item.system) return;

  item.system.babBase = 0;
  applySecondarySaveLag(item);

  // Original prepareDerivedData already called `_registerOnActor` with the
  // full-level save bases; refresh so `actor.classes[tag].savingThrows`
  // matches the lagged values.
  if (typeof item._registerOnActor === "function" && item.actor?.system) {
    item._registerOnActor();
  }
}

/**
 * Rewrite this Secondary class item's save bases to the lagged table
 * (own level − 2, floored at 1) so class-sheet display and later Change
 * construction both see the house-rule value.
 *
 * @param {pf1.documents.ItemPF} item
 */
function applySecondarySaveLag(item) {
  const level = laggedLevel(item.system.level);
  for (const saveId of SAVE_IDS) {
    const saveData = item.system.savingThrows?.[saveId];
    if (!saveData) continue;
    const lagged = recomputeClassSaveAtLevel(item, saveId, level);
    if (lagged != null) saveData.base = lagged;
  }
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
 * Keep only the higher of Primary @ own level vs Secondary @ lagged
 * level, independently per save. Mutates `changes` in place so pf1's
 * subsequent Collection copy never sees the losing class's contribution.
 *
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
function pickHighestClassSaves(actor, changes) {
  if (!actor || !Array.isArray(changes)) return;

  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return;

  const lagged = laggedLevel(secondary.system.level);
  const useFractional = game.settings.get("pf1", "useFractionalBaseBonuses");

  for (const saveId of SAVE_IDS) {
    const { primaryBase, secondaryLagged, winner, value } = compareDualClassSave(
      primary,
      secondary,
      saveId,
      lagged,
    );

    if (useFractional) {
      const secondaryStored = Number(secondary.system.savingThrows?.[saveId]?.base) || 0;
      replaceFractionalBaseSave(changes, saveId, primaryBase + secondaryStored, value);
      continue;
    }

    const keep = winner === "primary" ? primary : secondary;
    const drop = winner === "primary" ? secondary : primary;
    const keepValue = winner === "primary" ? primaryBase : secondaryLagged;

    removeClassSaveChange(changes, saveId, drop.name);
    ensureClassSaveChange(changes, saveId, keep.name, keepValue);
  }
}

/**
 * @param {pf1.components.ItemChange} change
 * @param {string} saveId
 * @param {string} className
 */
function isClassSaveChange(change, saveId, className) {
  if (change?.target !== saveId) return false;
  if (change.flavor !== className) return false;
  if (change.type && change.type !== "untypedPerm") return false;
  return isNumericFormula(change);
}

/** @param {pf1.components.ItemChange} change */
function isNumericFormula(change) {
  const formula = change?.formula;
  if (typeof formula === "number") return Number.isFinite(formula);
  if (typeof formula !== "string" || formula === "") return false;
  return Number.isFinite(Number(formula));
}

/**
 * @param {pf1.components.ItemChange[]} changes
 * @param {string} saveId
 * @param {string} className
 */
function removeClassSaveChange(changes, saveId, className) {
  for (let i = changes.length - 1; i >= 0; i--) {
    if (isClassSaveChange(changes[i], saveId, className)) changes.splice(i, 1);
  }
}

/**
 * Keep the winning class's existing save Change when its formula already
 * matches; otherwise replace (or insert) so a missed item-side lag wrap
 * cannot leave Secondary contributing its full-level table.
 *
 * @param {pf1.components.ItemChange[]} changes
 * @param {string} saveId
 * @param {string} className
 * @param {number} value
 */
function ensureClassSaveChange(changes, saveId, className, value) {
  const idx = changes.findIndex((change) => isClassSaveChange(change, saveId, className));
  if (idx >= 0 && Number(changes[idx].formula) === value) return;

  const next = new pf1.components.ItemChange({
    formula: value,
    target: saveId,
    type: "untypedPerm",
    flavor: className,
  });
  if (idx >= 0) changes[idx] = next;
  else if (value) changes.push(next);
}

/**
 * Fractional mode collapses every class into one "Base" Change. Rewrite
 * that to max(Primary, Secondary@lag) instead of floor(sum).
 *
 * @param {pf1.components.ItemChange[]} changes
 * @param {string} saveId
 * @param {number} summed - floor(sum) value pf1 just pushed
 * @param {number} value - max(Primary, Secondary@lag)
 */
function replaceFractionalBaseSave(changes, saveId, summed, value) {
  const desired = Math.floor(value);
  const summedFloor = Math.floor(summed);
  const baseFlavors = new Set(
    ["PF1.Base", "PF1.ModifierType.base"].map((key) => game.i18n?.localize?.(key) ?? key),
  );

  const idx = changes.findIndex((change) => {
    if (change?.target !== saveId) return false;
    if (change.type && change.type !== "untypedPerm") return false;
    if (!isNumericFormula(change)) return false;
    if (baseFlavors.has(change.flavor)) return true;
    return Math.floor(Number(change.formula)) === summedFloor;
  });

  if (idx >= 0 && Number(changes[idx].formula) === desired) return;

  const next = new pf1.components.ItemChange({
    formula: desired,
    target: saveId,
    type: "untypedPerm",
    flavor: idx >= 0 ? changes[idx].flavor : (game.i18n?.localize?.("PF1.Base") ?? "Base"),
  });
  if (idx >= 0) changes[idx] = next;
  else changes.push(next);
}

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applySavesAndBabChanges(actor, changes) {
  if (!actor || !changes) return;

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

  // §1.4 BAB is handled by registerSecondaryBabSuppression() (zeroes
  // Secondary babBase during item prep). §3.1 base saves are handled
  // there too: Secondary bases are lagged and the losing class's save
  // Change is dropped, rather than summing both and cancelling.
}
