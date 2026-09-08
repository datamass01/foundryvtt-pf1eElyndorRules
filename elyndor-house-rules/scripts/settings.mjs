/**
 * §1.1 — Point buy, 30 points.
 *
 * pf1 already ships a Point Buy Calculator (module/applications/point-buy-calculator.mjs)
 * with named tiers in `CONFIG.PF1.pointBuy` (low:10, standard:15, high:20,
 * epic:25) — the calculator just uses these to label whichever total the
 * GM/player lands on, it does not hard-restrict spending to a tier. Adding
 * a "custom30" tier is a one-line CONFIG.PF1 mutation, no fork needed.
 */
import { MODULE_ID } from "./const.mjs";

export function registerPointBuyTier() {
  if (pf1.config.pointBuy.elyndor) return; // Already registered (e.g. hot-reload during dev).
  pf1.config.pointBuy.elyndor = {
    label: "ELYNDOR.PointBuy.Elyndor",
    points: 30,
  };
}

/**
 * World settings for optional/toggleable behavior. Kept minimal — most
 * house rules are always-on for this module, not configurable, since the
 * whole point is "this is how Elyndor pf1 works," not a general-purpose
 * toggle library.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, "showSkillPoolPanel", {
    name: "ELYNDOR.Settings.ShowSkillPoolPanel.Name",
    hint: "ELYNDOR.Settings.ShowSkillPoolPanel.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
}
