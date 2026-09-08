/**
 * §4.1 — 1 feat per character level (replaces pf1's core "1 feat every odd
 * level").
 *
 * pf1's feat count is hardcoded in `ActorPF#getFeatCount()`
 * (RefCode/module/documents/actor.mjs, `Math.ceil(hd.total / 2)`), with no
 * hook around that specific computation — but it already reads
 * `system.details.feats.bonus`, fed by the `bonusFeats` Change target
 * (config.mjs buffTargets; apply-changes.mjs). The gap between "1/level"
 * and "1/odd-level" is a deterministic function of level, so it can be
 * fully compensated additively — no per-actor bookkeeping needed.
 *
 * `ActorPF#getFeatCount()` itself uses `attributes.hd.total` as its level
 * input, so the "core" side of this delta reads that same field — by
 * design this runs AFTER `changes/character-level.mjs` has already
 * corrected `hd.total` down to true character level (Primary and Secondary
 * both advancing every character level would otherwise make it double —
 * see that file's header comment), so `hdTotal` below is already correct
 * here, not a doubled value needing separate compensation. `characterLevel`
 * is still read directly from `primary.system.level` rather than solely
 * trusting `hd.total`, both as a clear, self-documenting source of truth
 * and as a fallback in case `character-level.mjs`'s fix hasn't run yet for
 * any reason (e.g. hook registration order changes).
 */
import { getPrimaryClass } from "../class-roles.mjs";

/**
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applyFeatCountChange(actor, changes) {
  const primary = getPrimaryClass(actor);
  if (!primary) return; // Dual-class structure not set up yet on this actor.

  const characterLevel = primary.system.level ?? 0;
  const hdTotal = actor.system.attributes?.hd?.total ?? characterLevel;
  const coreFeatCount = Math.ceil(hdTotal / 2);
  const delta = characterLevel - coreFeatCount;

  if (delta !== 0) {
    changes.push(
      new pf1.components.ItemChange({
        formula: String(delta),
        operator: "add",
        target: "bonusFeats",
        type: "untyped",
      }),
    );
  }
}
