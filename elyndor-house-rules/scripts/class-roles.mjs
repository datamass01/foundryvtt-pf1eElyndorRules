/**
 * Primary/Secondary class-role bookkeeping.
 *
 * This is the single manual step a GM/player performs (toggle a class item's
 * role via `ui/class-role-toggle.mjs` on the class Item Sheet, or the Class
 * Role column on the character sheet's classes list); every other module
 * file resolves "which class is Secondary/Primary" through the helpers here,
 * so there is exactly one place that defines what those words mean.
 */
import { MODULE_ID, ROLE_FLAG, ROLE, SECONDARY_LEVEL_LAG, SECONDARY_LEVEL_FLOOR } from "./const.mjs";

/**
 * @param {pf1.documents.ItemPF} item
 * @returns {"primary"|"secondary"|null}
 */
export function getClassRole(item) {
  return item?.getFlag(MODULE_ID, ROLE_FLAG) ?? null;
}

/** @param {pf1.documents.ItemPF} item */
export function isPrimaryClass(item) {
  return getClassRole(item) === ROLE.PRIMARY;
}

/** @param {pf1.documents.ItemPF} item */
export function isSecondaryClass(item) {
  return getClassRole(item) === ROLE.SECONDARY;
}

/** @param {pf1.documents.ActorPF} actor */
export function getPrimaryClass(actor) {
  return actor?.itemTypes?.class?.find((c) => isPrimaryClass(c)) ?? null;
}

/** @param {pf1.documents.ActorPF} actor */
export function getSecondaryClass(actor) {
  return actor?.itemTypes?.class?.find((c) => isSecondaryClass(c)) ?? null;
}

/**
 * Whether a class item is eligible to be marked Secondary: it must be a
 * caster whose spellcasting starts at 1st class level (no positive
 * `casting.offset`, which signals a late-starting caster like Paladin or
 * Ranger). This is checked against the class's own data, not a hardcoded
 * class-name list, so it stays correct for homebrew/3rd-party classes too.
 *
 * @param {pf1.documents.ItemPF} item
 */
export function isEligibleSecondary(item) {
  const casting = item?.system?.casting;
  if (!casting?.type) return false;
  if (casting.offset) return false;
  return true;
}

/**
 * Set (or clear) a class item's Primary/Secondary role, enforcing at most
 * one holder of each role per actor. Advisory, not hard-blocking, to match
 * pf1's own UI style: an ineligible Secondary pick warns and refuses rather
 * than throwing.
 *
 * @param {pf1.documents.ItemPF} item
 * @param {"primary"|"secondary"|null} role
 * @returns {Promise<boolean>} `true` if the flag was written (or cleared);
 *   `false` if the request was refused (no actor, ineligible Secondary).
 */
export async function setClassRole(item, role) {
  const actor = item?.actor;
  if (!actor) return false;

  if (role === ROLE.SECONDARY && !isEligibleSecondary(item)) {
    ui.notifications?.warn(
      game.i18n.format("ELYNDOR.Warnings.NotEligibleSecondary", { name: item.name }),
    );
    return false;
  }

  if (role) {
    const others = actor.itemTypes.class.filter((c) => c.id !== item.id && getClassRole(c) === role);
    for (const other of others) {
      await other.unsetFlag(MODULE_ID, ROLE_FLAG);
    }
    if (others.length) {
      ui.notifications?.info(
        game.i18n.format("ELYNDOR.Info.RoleReassigned", {
          from: others.map((o) => o.name).join(", "),
          to: item.name,
        }),
      );
    }
  }

  if (role) await item.setFlag(MODULE_ID, ROLE_FLAG, role);
  else await item.unsetFlag(MODULE_ID, ROLE_FLAG);
  return true;
}

/**
 * The level to use for Secondary-class base-save and non-caster
 * special-ability scaling lookups: its own (lockstep) level minus the
 * configured lag, floored at 1.
 *
 * @param {number} level - The Secondary class item's own `system.level`.
 */
export function laggedLevel(level) {
  return Math.max((level ?? 0) - SECONDARY_LEVEL_LAG, SECONDARY_LEVEL_FLOOR);
}

/**
 * Warn (does not block) if the Primary and Secondary class items on an
 * actor have drifted out of lockstep. The design requires them to advance
 * together every character level; nothing enforces that automatically
 * during normal multiclass leveling, so this is a safety net.
 *
 * @param {pf1.documents.ActorPF} actor
 */
export function checkLockstep(actor) {
  const primary = getPrimaryClass(actor);
  const secondary = getSecondaryClass(actor);
  if (!primary || !secondary) return;
  if (primary.system.level !== secondary.system.level) {
    ui.notifications?.warn(
      game.i18n.format("ELYNDOR.Warnings.LevelDrift", {
        actor: actor.name,
        primary: primary.system.level,
        secondary: secondary.system.level,
      }),
    );
  }
}
