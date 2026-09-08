/**
 * Elyndor House Rules — entry point.
 *
 * See Docs/house-rules/character-creation-and-system-rules.md for the
 * rules this implements, and
 * /home/entropy/.claude/plans/ok-here-is-the-distributed-curry.md for the
 * implementation plan and architecture rationale.
 */
import { MODULE_ID } from "./const.mjs";
import { registerPointBuyTier, registerSettings } from "./settings.mjs";
import { checkLockstep } from "./class-roles.mjs";
import { applyCharacterLevelFix } from "./changes/character-level.mjs";
import { applySavesAndBabChanges } from "./changes/saves-bab-lag.mjs";
import { applyFeatCountChange } from "./changes/feats.mjs";
import { applySkillPointsChange } from "./changes/skill-points-total.mjs";
import { applyMovementChanges } from "./changes/movement.mjs";
import { registerClassRoleToggle } from "./ui/class-role-toggle.mjs";
import { registerSkillPoolPanel } from "./ui/skill-pool-panel.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerClassRoleToggle();
  registerSkillPoolPanel();
});

// Quench (https://github.com/Ethaks/FVTT-Quench) is an optional dev-only
// dependency — tests only register if it's actually installed/enabled.
Hooks.once("quenchReady", async () => {
  const { registerDualClassTests } = await import("../test/dual-class.test.mjs");
  registerDualClassTests();
});

Hooks.once("setup", () => {
  // pf1.config (== CONFIG.PF1) is populated by pf1's own "init" hook, so
  // this can only be safely mutated from "setup" onward, not from our own
  // "init" above.
  registerPointBuyTier();
});

/**
 * The single hook every additive house-rule Change is pushed through.
 *
 * CORRECTION (verified live against a running Foundry v13 + pf1 v11.11
 * instance — see the module README's "Known risks" / verification log):
 * RefCode/module/hooks.d.ts:518-532 documents this as `pf1.change.defaults`,
 * but the actually-installed v11.11 *build* (as opposed to RefCode's
 * checked-out dev-branch source, which is ahead of it despite the matching
 * version number) still fires the legacy pre-rename hook name
 * `pf1AddDefaultChanges` — confirmed via the shipped `pf1.js` bundle, which
 * contains `Hooks.callAll("pf1AddDefaultChanges", this, t)` and no
 * `"pf1.change.defaults"` string anywhere. `Hooks.on("pf1.change.defaults", ...)`
 * registers fine but pf1 never calls it, so every Change below silently
 * never applied until this was caught by live testing. Signature is
 * unchanged: `(actor, changes)`.
 *
 * This hands us a fresh array that gets concatenated onto the actor's real
 * Change list, so every function below (except applyCharacterLevelFix, a
 * direct mutation — see its own header comment for why that's safe here)
 * may only ADD Changes, never remove/replace pf1's own.
 *
 * applyCharacterLevelFix runs FIRST: it corrects `attributes.hd.total` and
 * `details.level.value` (which pf1 would otherwise double under lockstep
 * Primary/Secondary leveling) before anything else — including
 * applyFeatCountChange/applySkillPointsChange below — reads them.
 */
Hooks.on("pf1AddDefaultChanges", (actor, changes) => {
  applyCharacterLevelFix(actor);
  applySavesAndBabChanges(actor, changes);
  applyFeatCountChange(actor, changes);
  applySkillPointsChange(actor, changes);
  applyMovementChanges(actor, changes);
});

/**
 * Advisory-only safety net: warn (never block) if a set-up Primary/
 * Secondary pair has drifted out of the lockstep leveling the design
 * relies on (Docs/house-rules §1.2).
 *
 * CORRECTION (verified live, same as above): the installed build fires
 * `pf1ClassLevelChange`, not the RefCode-documented `pf1.item.level`, with
 * signature `(actor, item, newLevel, oldLevel)` rather than `(item)`.
 */
Hooks.on("pf1ClassLevelChange", (actor) => {
  if (actor) checkLockstep(actor);
});

console.log(`${MODULE_ID} | Loaded`);
