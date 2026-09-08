/**
 * Corrects `attributes.hd.total` and `details.level.value` so Hit Dice and
 * character level do NOT double under lockstep Primary/Secondary leveling.
 *
 * pf1 computes both by summing every class item's own `hitDice`/`level`
 * (`base-character-model.mjs:1200-1216`, `_preparePostEmbedded()`):
 *
 *   for (const cls of classes) {
 *     hd += cls.system.hitDice;
 *     level += cls.system.level;   // (unless the class is tagged xpUnbound)
 *   }
 *
 * Under the lockstep-leveling design decision (Docs/house-rules §1.2), the
 * Secondary class item's own `level`/`hitDice` track character level right
 * alongside Primary's — so this sum comes out to *twice* true character
 * level on a fully set-up dual-class actor. Per the GM's ruling, Hit Dice
 * must NOT double: a dual-class character has the same number of Hit Dice
 * (= character level) as a single-classed one, they're just bigger/better
 * dice thanks to both classes contributing HP each level.
 *
 * This is corrected by directly subtracting Secondary's own contribution
 * back out — not by re-deriving from Primary alone — so it stays correct
 * even if a third (un-flagged) class item is ever added to the actor.
 *
 * WHY A DIRECT MUTATION, NOT A CHANGE: `attributes.hd.total` and
 * `details.level.value` are plain aggregated fields, not `buffTargets` —
 * there is no Change target for either, so `pf1.change.defaults`' normal
 * "push a Change" mechanism can't reach them. Direct mutation is safe here
 * specifically because of *when* this hook fires: `_preparePostEmbedded()`
 * (which sets both fields) has already run by the time `pf1.change.defaults`
 * fires (confirmed: `ActorPF#_prepareChanges()`, actor.mjs, calls
 * `system._prepareChanges(changes)` — which is where `_preparePostEmbedded`'s
 * results are already sitting in `this.attributes`/`this.details` — BEFORE
 * firing the hook), while every consumer of these two fields that matters
 * (`applyChanges()`'s resolution of the CON-to-HP formula
 * `"@attributes.hpAbility.mod * @attributes.hd.total"` at
 * base-character-model.mjs:1753; `ActorPF#getFeatCount()`,
 * actor.mjs:1925; natural rest-healing, `onRestUpdate()`,
 * base-character-model.mjs:1449) runs strictly LATER, in `prepareDerivedData()`
 * or on-demand after the full prepare cycle completes. So this mutation is
 * guaranteed to land before anything reads the corrected value, and it also
 * transparently fixes two side-effect bugs this ruleset would otherwise
 * introduce into pf1's own code: CON's contribution to HP, and how much HP
 * a full night's rest restores, were BOTH silently doubled without this fix
 * (both formulas multiply by `attributes.hd.total` directly).
 *
 * This must run BEFORE feats.mjs/skill-points-total.mjs in the
 * `pf1.change.defaults` handler (see module.mjs) so they see the corrected
 * total rather than computing their own workaround against the doubled one.
 *
 * @param {pf1.documents.ActorPF} actor
 */
import { getSecondaryClass } from "../class-roles.mjs";

export function applyCharacterLevelFix(actor) {
  const secondary = getSecondaryClass(actor);
  if (!secondary) return; // No dual-class structure set up (yet) on this actor.

  const secondaryHD = secondary.system.hitDice || 0;
  const secondaryLevel = secondary.system.level || 0;

  const hd = actor.system.attributes?.hd;
  if (hd) hd.total = Math.max(0, (hd.total ?? 0) - secondaryHD);

  const level = actor.system.details?.level;
  if (level) level.value = Math.max(0, (level.value ?? 0) - secondaryLevel);
}
