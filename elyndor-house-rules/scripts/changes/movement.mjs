/**
 * §6.2/§6.3 — Dex-to-speed scaling.
 *
 *  - ±5 ft. of land speed per point of *permanent* Dex modifier.
 *  - A positive Dex *buff* (temporary, from a Buff-type item) grants no
 *    speed bonus beyond what the character's permanent Dex already gives.
 *  - A negative Dex effect (drain, damage, a debuff) CAN reduce speed
 *    below what permanent Dex alone would give, but never below the
 *    creature's racial base speed.
 *  - Net rule implemented below: `effectiveMod = min(permanentMod, totalMod)`
 *    — buffs (which only raise totalMod above permanentMod) are ignored;
 *    debuffs/drain/damage (which lower totalMod below permanentMod) apply.
 *
 * pf1 exposes `abilities.<id>.total` (post-Changes score) and `.mod`
 * (derived from `.total`) but has no separate "permanent-only" ability
 * score/modifier field — so "permanent" here is approximated as
 * total-score-minus-currently-active-Buff-item contributions. Racial,
 * feat, and other non-Buff-sourced Changes (e.g. a Dwarf's racial CON/WIS
 * adjustments) are correctly treated as permanent since they aren't on
 * Buff items. This is the least certain piece of the whole module — see
 * the module README's "Known risks" section for the manual live-test to
 * run before trusting it at the table (apply a temporary +Dex buff and
 * confirm speed doesn't rise; apply a Dex-drain/damage effect and confirm
 * speed falls, floored at racial base).
 *
 * Run feat's own +5 ft. (§6.4) is NOT handled here — it's a plain
 * `landSpeed` Change on the Run feat's own compendium data
 * (packs/elyndor-feats/run.yaml), since it's a flat, unconditional bonus
 * with no permanent/buffed distinction to worry about.
 */

const SPEED_PER_DEX_MOD = 5;

/**
 * Sum of Changes targeting `abilityId` contributed by currently-active
 * Buff-type items only (i.e., temporary effects, as opposed to racial
 * traits, feats, or other permanent sources).
 *
 * @param {pf1.documents.ActorPF} actor
 * @param {string} abilityId
 */
function activeBuffAbilityScoreBonus(actor, abilityId) {
  let bonus = 0;
  const rollData = actor.getRollData();
  for (const buff of actor.itemTypes?.buff ?? []) {
    if (!buff.isActive) continue;
    for (const change of Object.values(buff.system.changes ?? {})) {
      if (change.target !== abilityId) continue;
      bonus += pf1.dice.RollPF.safeRollSync(String(change.formula ?? 0), rollData).total || 0;
    }
  }
  return bonus;
}

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applyMovementChanges(actor, changes) {
  const base = actor.system.attributes?.speed?.land?.base;
  if (!base) return; // No land speed (e.g. purely aquatic/incorporeal) — nothing to scale.

  // CORRECTION (verified live): `pf1AddDefaultChanges` fires while pf1 is
  // still ASSEMBLING the actor's Change list — ability-score Changes
  // (including the character's own permanent Dex score, any active Buff's
  // Dex bonus, and even racial Dex adjustments) have NOT been applied yet,
  // so `actor.system.abilities.dex.total`/`.mod` still read the *previous*
  // prepare cycle's stale value at this point (confirmed live: reading them
  // here returned the raw un-Changed base score, not the actual current
  // total). Computing permanentMod/totalMod eagerly as plain numbers (the
  // original approach) silently computed against stale data every time.
  //
  // Fix: only `buffBonus` is safe to compute eagerly here — it depends on
  // buff *items'* own already-prepared local data (which items/pf1 have
  // already resolved earlier in the actor-prepare pipeline by the time this
  // hook fires), not on the actor's own ability-score Change resolution.
  // The ability-score-dependent part of the math is pushed as a Change
  // *formula string* instead of a precomputed number — exactly like the
  // doubled-save-ability-mod Changes in saves-bab-lag.mjs — so it's
  // evaluated later, after abilities are fully resolved, the same pattern
  // pf1's own Changes use throughout.
  const buffBonus = activeBuffAbilityScoreBonus(actor, "dex");
  changes.push(
    new pf1.components.ItemChange({
      formula: `max(0, min(floor((@abilities.dex.total - (${buffBonus}) - 10) / 2), @abilities.dex.mod) * ${SPEED_PER_DEX_MOD})`,
      operator: "add",
      target: "landSpeed",
      type: "untyped",
      // See feats.mjs's applyFeatCountChange for why `flavor` is required
      // here: without it this parentless ItemChange shows as a bare
      // "Untyped" line instead of its true source. Same
      // `pf1.config.abilities[ability]` pattern already used for the
      // second-save Changes in saves-bab-lag.mjs.
      flavor: pf1.config.abilities.dex,
    }),
  );
}
