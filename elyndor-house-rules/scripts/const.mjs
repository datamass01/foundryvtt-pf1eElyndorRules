/**
 * Shared constants for the Elyndor House Rules module.
 */

/** Module id, must match module.json#id. */
export const MODULE_ID = "elyndor-house-rules";

/** Flag key (under MODULE_ID) storing a class item's Primary/Secondary role. */
export const ROLE_FLAG = "role";

/** Possible values of the role flag. */
export const ROLE = /** @type {const} */ ({
  PRIMARY: "primary",
  SECONDARY: "secondary",
});

/**
 * How many character levels the Secondary class's base save and
 * non-caster special-ability scaling lag behind its own (lockstep) level.
 * See Docs/house-rules/character-creation-and-system-rules.md §1.2/§3.1.
 */
export const SECONDARY_LEVEL_LAG = 2;

/** Floor applied to the lagged level so it never drops below 1. */
export const SECONDARY_LEVEL_FLOOR = 1;
