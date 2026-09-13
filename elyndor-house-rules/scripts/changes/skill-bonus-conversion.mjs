/**
 * §2.3 — Skill Bonus Conversion (Non-Ability Modifiers).
 *
 * Rule (Docs/house-rules/character-creation-and-system-rules.md §2.3):
 * ranks, the ability modifier, AND the standard class-skill trained +3
 * all apply to a skill normally; every OTHER bonus a character would get
 * from class benefits, feats, magic items, or other sources is instead
 * summed (per standard Pathfinder stacking rules) and converted through
 * one table instead of applying directly:
 *   2-5  -> +2 Skill Bonus
 *   6-10 -> Advantage (roll 2d20, keep the higher result)
 *   11+  -> +2 Skill Bonus & Advantage
 * A total of 0-1 falls below the lowest tier and is left alone entirely
 * (e.g. a single +1 trait bonus keeps applying as a plain +1).
 *
 * AMENDED 2026-09-12: the class-skill trained +3 was originally folded
 * into the convertible total (2026-09-09 decision) but that was reversed
 * — it's now excluded and always applies as a plain +3, same as rank and
 * the ability modifier. See `isClassSkillChange` below for the exact
 * Change shape this is detected by, verified against the installed pf1
 * v11.11 bundle's `_prepareClassSkills`/`addSKillChanges`.
 *
 * Two independent mechanisms, both live-verified against the installed
 * pf1 v11.11 build before this file was written — see the plan's "Phase 8
 * Spike Progress" section (session of 2026-09-09) for the raw findings.
 *
 * === NUMERIC HALF (applySkillBonusConversion) ===
 * Every contributor to a skill's `mod` — including rank and the ability
 * modifier — is modeled as an ordinary `ItemChange` targeting
 * `skill.~<id>` (confirmed live: even the "Skill Ranks" and ability-mod
 * lines show up as real Changes, unlike the native per-class skill-RANK
 * total, which is bespoke procedural math with nothing to filter —
 * contrast skill-points-total.mjs's header comment). That means there is
 * no single native method to wrap-and-subtract a total from the way
 * BAB/skill-ranks do it: the "other bonus" total has to be computed by
 * walking the actor's own Changes and replicating pf1's bonus-type
 * stacking (same-type bonuses take only the highest, except
 * untyped/circumstance/dodge, which always stack).
 *
 * TIMING (verified live, and the reason this does NOT run from
 * `pf1AddDefaultChanges` the way every other Elyndor Change does):
 * `actor.changes` already looks fully populated by the time
 * `pf1AddDefaultChanges` fires (114 entries, full per-skill breakdown
 * included), and it IS the same Collection instance start to finish — but
 * live-diffing its contents before/after that hook proved every entry's
 * `_id` changes across the call, meaning the Collection gets entirely
 * discarded and rebuilt from items again afterward. Deleting from it
 * during `pf1AddDefaultChanges` is silently undone by that rebuild —
 * confirmed live: a suppression there measurably computed the right
 * total but the deleted Changes still doubled up in the final `mod`.
 * The rebuild's OWN output, before Collection-ization, turns out to be
 * exactly `saves-bab-lag.mjs`'s `_prepareTypeChanges(changes)` — the same
 * method that file already wraps for save suppression — whose `changes`
 * array argument (confirmed live, NOT the same object as `actor.changes`)
 * is the actual near-final list Changes get applied from. So this file's
 * suppression wraps that same method too (composes fine with the
 * existing BAB/save wrap — `wrapOwnAfter` chains correctly across
 * multiple callers) instead of hooking `pf1AddDefaultChanges` at all.
 *
 * IMPORTANT: pf1's own `sourceInfo` breakdown for a skill's `mod` lists
 * every CONTRIBUTING Change at its full nominal value even when stacking
 * would exclude it from the real total (verified live: two "competence"
 * Changes of +2 and +5 both showed their full nominal value in
 * `sourceInfo`, even though only the +5 actually counted toward `mod`).
 * So `mod - rank - abilityMod` is NOT a safe shortcut for "the total
 * value of these modifiers" — besides double-counting non-stacking
 * duplicates, it would also let ACP / Wound Threshold / Negative Level
 * penalties (which this rule doesn't touch — only BONUSES convert) eat
 * into the qualifying total. Only Changes that evaluate to a strictly
 * positive value are ever candidates; everything else (ability mod, rank,
 * ACP, and any other zero-or-negative contributor) is left completely
 * alone and keeps applying exactly as pf1 already computes it.
 *
 * Once the total is known, the specific candidate Changes are spliced out
 * of the `_prepareTypeChanges` array described above — before pf1 turns
 * it into the Collection it applies to the skill's target — and one flat
 * `+2` replacement Change is pushed into that same array when the table
 * calls for it. Suppress at the source, never a cancelling negative
 * Change — same rule this whole module follows (see saves-bab-lag.mjs's
 * header for why).
 *
 * === ADVANTAGE HALF (handlePreActorRollSkill / handlePreD20Roll) ===
 * No Change can express "roll 2d20 keep highest", so this hooks the
 * actual roll instead. `pf1PreActorRollSkill(actor, rollOptions,
 * skillId)` fires first and tags the shared `rollOptions` object
 * (confirmed live, by reference identity, to be the SAME object later
 * passed as `options` to `pf1PreD20Roll(roll, options)` — the only way to
 * carry `skillId` forward, since the d20 hook itself never receives it).
 * `pf1PreD20Roll` fires with an UNEVALUATED `D20RollPF`; when the tag
 * says this skill qualifies, mutating its sole `Die` term
 * (`number: 2, modifiers: ["kh1"]`) and then calling `roll.resetFormula()`
 * — required, or the chat card keeps showing the stale `"1d20"` formula
 * even though it genuinely rolled two dice, the same "phantom tooltip
 * line" complaint this module treats as a real bug everywhere else —
 * produces a correctly-evaluated, correctly-labeled 2d20-keep-highest
 * roll (verified live: chat payload formula `"2d20kh1"`, two real die
 * results, the losing one flagged `discarded`).
 *
 * `handlePreD20Roll` also folds the roll dialog's own "Situational Bonus"
 * field into the same conversion — a real user report (session of
 * 2026-09-09) caught a plain "+5" typed there applying as a raw,
 * unconverted modifier, bypassing §2.3 entirely. Only a flat numeric
 * situational entry is folded (recombined with the skill's cached
 * persistent total and reconverted for that roll only, never written
 * back to the sheet); a dice-based one (the field also accepts formulas
 * like `1d6[Inspiration] + 2[Aid] + 1`) is left untouched, since there's
 * nothing to statically convert before the dice are rolled. See
 * `foldSituationalBonus`'s own header for the exact detection mechanism.
 *
 * NOT YET HANDLED: subskills (Craft/Profession/Perform instances) use a
 * different Change-target shape than the fixed base-skill list this file
 * walks (`skill.~<id>`) — unverified, skipped silently for now. A
 * situational bonus that itself uses `[Bracket]` flavor syntax (rather
 * than a bare number) also won't be detected — its flavored parts look
 * identical to a real tracked Change once built into the roll. See the
 * module README's Known risks once this is exercised end-to-end.
 */
import { wrapOwnAfter } from "../lib/wrap.mjs";

/**
 * Bonus types that stack with themselves under standard Pathfinder rules
 * (dodge and circumstance always stack; so does untyped, since it has no
 * type to compare against) — verified live against two same-type
 * "competence" Changes (+2 and +5): only the +5 counted toward `mod`,
 * confirming every other type takes only its highest contributor.
 */
const STACKING_TYPES = new Set(["untyped", "circumstance", "dodge"]);

/**
 * pf1's own Armor Check Penalty Change formula, verified live on Climb
 * (`target: "skill.~clm"`) — checked by formula rather than flavor text
 * since formulas aren't localized. Redundant with the value>0 filter
 * below (ACP is never positive) but kept explicit for clarity.
 */
const ACP_FORMULA = "-@attributes.acp.skill";

/**
 * The standard class-skill trained +3, excluded from §2.3's convertible
 * total per the house-rules doc's 2026-09-12 amendment (see file header)
 * — it applies as a plain, unconverted bonus, same as rank/ability mod.
 *
 * Verified live against the installed pf1 v11.11 bundle's
 * `_prepareClassSkills`/`addSKillChanges`: this Change is only pushed
 * when the skill has at least 1 rank, as `type: "untyped"`, `formula`/
 * `value` equal to `pf1.config.classSkillBonus` (3), flavor
 * `game.i18n.localize("PF1.CSTooltip")` ("Class Skill"). Checked by
 * flavor + formula together, the same pattern this file already uses for
 * the ability-mod Change, since neither alone is a safe-enough signal
 * (flavor is localized text; a coincidental untyped +3 from elsewhere
 * would match the formula alone).
 *
 * @param {pf1.components.ItemChange} change
 * @returns {boolean}
 */
function isClassSkillChange(change) {
  return (
    change.type === "untyped" &&
    change.flavor === game.i18n.localize("PF1.CSTooltip") &&
    Number(change.formula) === pf1.config.classSkillBonus
  );
}

/**
 * §2.3's conversion table.
 *
 * @param {number} total
 * @returns {{flat: number, advantage: boolean}}
 */
function convertSkillBonus(total) {
  if (total >= 11) return { flat: 2, advantage: true };
  if (total >= 6) return { flat: 0, advantage: true };
  if (total >= 2) return { flat: 2, advantage: false };
  return { flat: 0, advantage: false };
}

/** Shared flavor label for the flat replacement Change/roll term, both
 *  the persistent sheet Change (`applySkillBonusConversion`) and the
 *  roll-time recombination (`handlePreD20Roll`) — computed each call
 *  since `game.i18n` isn't guaranteed ready at module-load time. */
function conversionFlavor() {
  return game.i18n?.localize?.("ELYNDOR.SkillBonusConversion") ?? "Skill Bonus Conversion (Elyndor)";
}

/**
 * Walk the near-final `changes` array (see file header — NOT
 * `actor.changes`) for one skill and split its contributors into "the
 * total value of these [bonus] modifiers" (§2.3's own phrasing,
 * stacking-resolved) and the exact Change objects that total came from
 * (so the caller can splice out precisely those, and nothing else).
 *
 * @param {pf1.components.ItemChange[]} changes
 * @param {string} skillId
 * @param {string} ability - This skill's governing ability id (e.g. "dex").
 * @param {object} rollData
 * @returns {{total: number, included: pf1.components.ItemChange[]}}
 */
function collectSkillBonusChanges(changes, skillId, ability, rollData) {
  const target = `skill.~${skillId}`;
  const abilityLabel = pf1.config.abilities[ability];
  const abilityFormula = `@abilities.${ability}.mod`;

  const included = [];
  let total = 0;
  const highestByType = new Map();

  for (const change of changes) {
    if (change.target !== target) continue;
    if (change.type === "base") continue; // rank — never converted
    if (change.flavor === abilityLabel && change.formula === abilityFormula) continue; // ability mod
    if (change.formula === ACP_FORMULA) continue; // Armor Check Penalty — a penalty, not a bonus
    if (isClassSkillChange(change)) continue; // class-skill trained +3 — always plain, never converted

    const value = RollPF.safeRollSync(String(change.formula), rollData).total ?? 0;
    if (value <= 0) continue; // only BONUSES convert — zero/negative contributors are left alone

    included.push(change);
    if (STACKING_TYPES.has(change.type)) {
      total += value;
    } else {
      const current = highestByType.get(change.type) ?? -Infinity;
      if (value > current) highestByType.set(change.type, value);
    }
  }

  for (const value of highestByType.values()) total += value;
  return { total, included };
}

/**
 * pf1 also lets a Change target ALL skills at once (`target: "skills"`,
 * plural) — the same mechanism its own native "Wound Threshold"/
 * "Negative Levels" penalties use, and a real-world reproduction bug
 * (session of 2026-09-09: a Buff with a flat `target: "skills"` bonus
 * kept applying on top of the flat conversion instead of being folded
 * into it) confirmed live that `collectSkillBonusChanges`'s per-skill
 * `target === "skill.~<id>"` match silently ignores it entirely.
 *
 * A single shared global Change can't be suppressed the same way a
 * per-skill one is: deleting it once (to convert it for skill A) would
 * remove it from every OTHER skill's total too, even skills whose own
 * total the global's removal was never evaluated against. So before the
 * per-skill pass runs, "unroll" every `target: "skills"` Change in the
 * array into one independent clone per skill, each retargeted to
 * `skill.~<id>` — then each skill's own clone can be converted or left
 * alone entirely independently, using the exact same per-skill logic
 * already built for genuinely skill-specific Changes. This mirrors how
 * pf1's own `sourceInfo` already displays a "Wound Threshold" line
 * separately under every individual skill from that one shared Change,
 * just materialized as real distinct objects instead of one shared
 * reference evaluated N times for display.
 *
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
function unrollGlobalSkillChanges(actor, changes) {
  const skillIds = Object.keys(actor.system.skills ?? {});
  if (!skillIds.length) return;

  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    if (change.target !== "skills") continue;

    changes.splice(i, 1);
    for (const skillId of skillIds) {
      changes.push(
        new pf1.components.ItemChange({
          formula: change.formula,
          operator: change.operator ?? "add",
          target: `skill.~${skillId}`,
          type: change.type,
          flavor: change.flavor,
        }),
      );
    }
  }
}

/**
 * §2.3 numeric half. Called from a `_prepareTypeChanges` wrap (see
 * `registerSkillBonusSuppression` below and the file header for why —
 * NOT from `pf1AddDefaultChanges` the way every other Elyndor Change is).
 * `changes` here is the near-final array Changes get applied from, so
 * splicing entries out of it (rather than `actor.changes`) actually
 * suppresses them — never a cancelling negative Change, same rule this
 * whole module follows.
 *
 * Also caches which skills currently qualify for Advantage directly on
 * the actor instance (`actor._elyndorSkillAdvantage`, a plain expando
 * property, recomputed every prepare pass — never a `flags` update, which
 * would trigger a write/re-render loop from inside data prep) for
 * `handlePreActorRollSkill` to read when a check is actually rolled.
 *
 * @param {pf1.documents.ActorPF} actor
 * @param {pf1.components.ItemChange[]} changes
 */
export function applySkillBonusConversion(actor, changes) {
  if (!actor?.system?.skills || !Array.isArray(changes)) return;

  unrollGlobalSkillChanges(actor, changes);

  const rollData = actor.getRollData();
  const advantageSkills = new Set();
  const bonusTotals = new Map();
  const bonusFlavors = new Map();

  for (const [skillId, skill] of Object.entries(actor.system.skills)) {
    const { total, included } = collectSkillBonusChanges(changes, skillId, skill.ability, rollData);
    // Cached for EVERY skill, not just ones that convert — a below-floor
    // total (e.g. a single +1 trait bonus) still needs to be known at
    // roll time, since a situational bonus typed into the roll dialog
    // can push the combined total over the floor (see handlePreD20Roll).
    // The flavor set is cached too, for the same reason: when that
    // happens, the raw terms these `included` Changes already contributed
    // to the roll (e.g. "RadicalTestBuff") need to be identified and
    // stripped, not just the stale flat term — otherwise they'd double
    // up with the freshly recomputed combined total.
    bonusTotals.set(skillId, total);
    bonusFlavors.set(skillId, new Set(included.map((c) => c.flavor).filter(Boolean)));
    if (total < 2) continue; // below the table's lowest tier — native bonus(es), if any, stay untouched

    const { flat, advantage } = convertSkillBonus(total);

    for (const change of included) {
      const idx = changes.indexOf(change);
      if (idx >= 0) changes.splice(idx, 1);
    }

    if (flat) {
      changes.push(
        new pf1.components.ItemChange({
          formula: flat,
          operator: "add",
          target: `skill.~${skillId}`,
          type: "untyped",
          flavor: conversionFlavor(),
        }),
      );
    }

    if (advantage) advantageSkills.add(skillId);
  }

  actor._elyndorSkillAdvantage = advantageSkills;
  actor._elyndorSkillBonusTotals = bonusTotals;
  actor._elyndorSkillBonusFlavors = bonusFlavors;
}

/**
 * Wrap `_prepareTypeChanges` (same method as `saves-bab-lag.mjs`'s
 * `registerSecondaryBabSuppression`; `wrapOwnAfter` composes cleanly
 * across multiple callers, so both run in registration order) so
 * `applySkillBonusConversion` sees the near-final Changes array instead
 * of the pre-rebuild snapshot `pf1AddDefaultChanges` would hand it.
 *
 * MUST be called from `Hooks.once("init")`, NOT `"setup"` — the opposite
 * of this module's usual rule (`registerSkillRankSuppression`/
 * `registerPointBuyTier` genuinely need "setup", since they read
 * `pf1.config`/`pf1.applications`, which aren't populated until pf1's own
 * "init" has run). This function only touches `CONFIG.Actor.*`, a
 * Foundry-core namespace available even at "init" (proven by
 * `registerSecondaryBabSuppression` already registering successfully
 * there). Registering this specific wrap late, from "setup", was tried
 * first and looked correct in every manual test — but verified live
 * (session of 2026-09-09) to silently never take effect in normal play:
 * `_prepareTypeChanges` is NOT part of the regular per-render prepare
 * cycle — for a given actor it effectively runs once, very early
 * (already-observed to run in this window before "setup" fires — see
 * `registerSecondaryBabSuppression`'s own `_prepareTypeChanges` wrap,
 * registered at "init", correctly reflecting its `pickHighestClassSaves`
 * logic on a cold load), and its result is then cached; neither a fresh
 * page load nor opening the actor sheet re-triggers it afterward, only
 * an explicit `actor.reset()+prepareData()`. A "setup"-registered wrap
 * therefore installed itself only *after* that one early call had
 * already happened and been cached — every skill bonus kept applying at
 * its raw, unconverted value in real play despite every manual
 * re-verification (which always forced a fresh recompute) showing it
 * working. Moving this call to "init" (ahead of that early invocation)
 * is the fix; see `module.mjs`'s own comment at the call site for the
 * full incident writeup.
 */
export function registerSkillBonusSuppression() {
  const Character = CONFIG.Actor.documentClasses?.character;
  if (Character?.prototype) {
    wrapOwnAfter(Character.prototype, "_prepareTypeChanges", function (changes) {
      applySkillBonusConversion(this, changes);
    });
  }

  // RefCode / TypeDataModel path (not used by the installed v11.11 build,
  // but the same house rule if the world is ever upgraded) — mirrors
  // saves-bab-lag.mjs's own dual registration for the same reason.
  const CharacterModel = CONFIG.Actor.dataModels?.character;
  if (CharacterModel?.prototype) {
    wrapOwnAfter(CharacterModel.prototype, "_prepareChanges", function (changes) {
      applySkillBonusConversion(this.parent, changes);
    });
  }
}

/**
 * `pf1PreActorRollSkill(actor, rollOptions, skillId)` — tags the shared
 * options object (see file header for the object-identity verification)
 * with this skill's cached persistent bonus total AND the flavor labels
 * that total was built from, so `handlePreD20Roll` below can re-run the
 * conversion at roll time (see its own header for why a plain boolean
 * isn't enough) without needing `skillId` itself (the d20 hook never
 * receives it).
 *
 * @param {pf1.documents.ActorPF} actor
 * @param {object} rollOptions
 * @param {string} skillId
 */
export function handlePreActorRollSkill(actor, rollOptions, skillId) {
  if (!rollOptions) return;
  rollOptions.__elyndorBaseTotal = actor?._elyndorSkillBonusTotals?.get(skillId) ?? 0;
  rollOptions.__elyndorBonusFlavors = [...(actor?._elyndorSkillBonusFlavors?.get(skillId) ?? [])];
}

/**
 * `pf1PreD20Roll(roll, options)` — if the shared options object was
 * tagged above, this does two things:
 *
 * 1. Mutates the still-unevaluated roll's sole `Die` term into
 *    2d20-keep-highest when the (possibly roll-time-recombined, see
 *    below) total earns Advantage. `resetFormula()` is required:
 *    without it the roll evaluates correctly but the chat card's
 *    serialized formula stays stale at "1d20" (verified live).
 *
 * 2. FOLDS the roll dialog's own "Situational Bonus" field into the same
 *    §2.3 conversion, live-verified against a real user report (session
 *    of 2026-09-09): typing e.g. "+5" into that field applied it as a
 *    raw, unconverted modifier, completely bypassing the house rule —
 *    exactly the "add instead of modify" bug reported. Verified live via
 *    real dialog interaction that pf1 builds the roll's terms as
 *    `[Die, Op, Num(2,"Charisma"), Op, Num(1,"RadicalTestBuff"), Op,
 *    Num(7, no flavor)]` — every tracked contributor (from
 *    `options.parts`, itself built from `actor.changes`) always carries
 *    a non-empty `flavor`, while the dialog's situational input is
 *    appended as a SEPARATE, unflavored term, entirely outside
 *    `options.parts`. That's the one reliable signal available to find
 *    it: scan the terms after the base die for unflavored `NumericTerm`s
 *    and sum them (see `recombineSkillRoll`).
 *
 *    Only a plain numeric situational bonus is folded — the field also
 *    accepts arbitrary dice formulas with their own `[Bracket]` flavors
 *    (per its own placeholder, `1d6[Inspiration] + 2[Aid] + 1`), which
 *    can't be run through a static conversion table (nothing to convert
 *    before the dice are rolled) and would be indistinguishable from a
 *    real tracked contributor once flavored. If any dice term is found
 *    among the unflavored candidates, or the flat sum isn't strictly
 *    positive (matching this rule's own "only bonuses convert" rule for
 *    persistent Changes — see the file header), nothing is folded and
 *    the roll is left exactly as pf1 built it.
 *
 * @param {Roll} roll
 * @param {object} options
 */
export function handlePreD20Roll(roll, options) {
  if (!options || typeof options.__elyndorBaseTotal !== "number") return;
  const baseTotal = options.__elyndorBaseTotal;
  const bonusFlavors = new Set(options.__elyndorBonusFlavors ?? []);
  delete options.__elyndorBaseTotal; // one-shot — this object isn't reused across separate rolls, but be defensive
  delete options.__elyndorBonusFlavors;
  if (roll._evaluated) return; // too late to mutate safely; nothing we can do at this point
  const die = roll.terms?.[0];
  if (!die || die.faces !== 20) return; // only ever touch the actual d20 term

  const folded = recombineSkillRoll(roll, baseTotal, bonusFlavors);
  const advantage = folded ? folded.advantage : convertSkillBonus(baseTotal).advantage;

  if (folded) roll.resetFormula?.();

  if (advantage) {
    die.number = 2;
    die.modifiers = [...new Set([...(die.modifiers ?? []), "kh1"])];
    roll.resetFormula?.();
  }
}

/**
 * Scans `roll.terms` after the base die for a plain numeric situational
 * addition (see `handlePreD20Roll`'s header for the detection rule), and
 * if one is found, REBUILDS `roll.terms` in place: every term whose
 * flavor is in `bonusFlavors` (this skill's persistent §2.3 contributors)
 * or is the flat conversion term itself is dropped — not just the flat
 * term — since all of it is superseded by reconverting the combined
 * total; ability-mod/ACP/anything else keeps its own term untouched; the
 * raw situational term(s) are dropped too; and one fresh flat term is
 * appended if the combined total earns one.
 *
 * A full rebuild (rather than splicing indices in place) sidesteps index
 * shifting entirely, and was the fix for a real bug caught live (session
 * of 2026-09-09): an earlier version only stripped the flat conversion
 * term, so a persistent contributor that was itself still raw (its own
 * total alone below the table's floor, e.g. a global +1 buff) survived
 * as a leftover term and double-counted alongside the freshly-added flat
 * bonus once a situational addition pushed the combined total over the
 * floor. Confirmed fixed live: `RadicalTestBuff`'s raw `+1` term no
 * longer survives when a situational bonus triggers recombination.
 *
 * @param {Roll} roll
 * @param {number} baseTotal
 * @param {Set<string>} bonusFlavors
 * @returns {{advantage: boolean} | null} `null` when there's nothing
 *   safe to fold (no unflavored terms, a dice term among them, or their
 *   sum isn't strictly positive) — `roll.terms` is left untouched.
 */
function recombineSkillRoll(roll, baseTotal, bonusFlavors) {
  const die = roll.terms[0];
  const pairs = [];
  for (let i = 1; i < roll.terms.length; i += 2) {
    const op = roll.terms[i];
    const term = roll.terms[i + 1];
    if (!term) break;
    pairs.push({ op, term });
  }

  let situationalTotal = 0;
  let hasDice = false;
  const kept = [];

  for (const { op, term } of pairs) {
    if (term instanceof foundry.dice.terms.DiceTerm) {
      hasDice = true; // a dice-based situational bonus — can't statically convert, bail entirely below
      continue;
    }
    const flavor = term.options?.flavor || term.flavor;
    if (!flavor) {
      // Unflavored numeric — the dialog's situational input (see header).
      if (typeof term.number === "number") {
        situationalTotal += (op?.operator === "-" ? -1 : 1) * term.number;
      }
      continue;
    }
    if (bonusFlavors.has(flavor) || flavor === conversionFlavor()) continue; // superseded by the recombined total
    kept.push({ op, term }); // ability mod, ACP, anything else this rule doesn't touch
  }

  if (hasDice || situationalTotal <= 0) return null;

  const { flat, advantage } = convertSkillBonus(baseTotal + situationalTotal);
  const newTerms = [die];
  for (const { op, term } of kept) newTerms.push(op, term);
  if (flat) {
    newTerms.push(
      new foundry.dice.terms.OperatorTerm({ operator: "+" }),
      new foundry.dice.terms.NumericTerm({ number: flat, options: { flavor: conversionFlavor() } }),
    );
  }
  roll.terms = newTerms;
  return { advantage };
}
