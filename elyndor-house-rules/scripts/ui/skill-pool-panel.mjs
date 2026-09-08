/**
 * §2.2 — advisory readout of the attribute-restricted skill-point pools,
 * injected into the character sheet's Skills tab.
 *
 * This is deliberately advisory-only, matching vanilla pf1's own
 * skill-rank UI (character-skill-list.hbs shows `allowed`/`used` counters
 * with no hard `max` on the rank input — pf1 already lets a player
 * over-spend and just shows the mismatch). pf1 has no concept of "which
 * pool paid for which rank," so this panel shows, per attribute, the
 * career-total points that pool has granted alongside the ranks currently
 * sitting in skills that ability governs — a sanity-check pairing, not an
 * authoritative ledger that nets out to a single "remaining" number.
 */
import { MODULE_ID } from "../const.mjs";
import { getPrimaryClass } from "../class-roles.mjs";
import { skillPointPools, POOL_ABILITIES } from "../lib/formulas.mjs";

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/skill-pool-panel.hbs`;
const INJECTED_CLASS = `${MODULE_ID}-skill-pool-panel`;

export function registerSkillPoolPanel() {
  // CORRECTION (verified live): the installed v11.11 build's actual PC
  // sheet class is `ActorSheetPFCharacter` (confirmed via
  // `actor.sheet.constructor.name`), not the RefCode-dev-branch-documented
  // `CharacterSheetPF` — same family of drift as class-role-toggle.mjs and
  // module.mjs's hook-name corrections.
  Hooks.on("renderActorSheetPFCharacter", onRenderCharacterSheet);
}

/**
 * @param {pf1.applications.actor.ActorSheetPFCharacter} app
 * @param {HTMLElement|JQuery} html
 */
async function onRenderCharacterSheet(app, html) {
  if (game.settings.get(MODULE_ID, "showSkillPoolPanel") === false) return;

  const actor = app.document ?? app.actor;
  if (!actor) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  root.querySelector(`.${INJECTED_CLASS}`)?.remove();

  const primary = getPrimaryClass(actor);
  if (!primary) return; // Nothing meaningful to show until the dual-class structure is set up.
  const characterLevel = primary.system.level ?? 0;

  const perLevelPools = skillPointPools(actor);
  const genericPerLevel = perLevelPools.con + perLevelPools.flat;

  const restrictedRows = POOL_ABILITIES.filter((id) => id !== "con").map((abilityId) => ({
    abilityId,
    // pf1.config.abilities[id] is a localization KEY (e.g. "PF1.AbilityScores.str.Label"),
    // resolved to a display string by the template via {{localize}}.
    label: pf1.config.abilities?.[abilityId] ?? abilityId,
    careerTotal: perLevelPools[abilityId] * characterLevel,
    ranksInMatchingSkills: sumRanksGovernedBy(actor, abilityId),
  }));

  const content = await renderTemplate(TEMPLATE_PATH, {
    characterLevel,
    restrictedRows,
    genericCareerTotal: genericPerLevel * characterLevel,
  });

  const wrapper = document.createElement("div");
  wrapper.innerHTML = content;
  const section = wrapper.firstElementChild;
  if (!section) return;
  section.classList.add(INJECTED_CLASS);

  // CORRECTION (verified live): the actual skills tab element is a
  // `<div class="tab skills ...">`, not a `<section>` as originally assumed
  // (a plain markup-detail miss, not the RefCode-vs-shipped-build API drift
  // seen elsewhere in this module) — match on `[data-tab="skills"]` alone
  // so the tag itself doesn't matter.
  const anchor = root.querySelector('[data-tab="skills"] header.skill-ranks');
  if (anchor) anchor.after(section);
  else root.querySelector('[data-tab="skills"]')?.prepend(section);
}

/**
 * Sum of ranks currently spent on skills (and sub-skills) whose governing
 * ability is `abilityId`. Intimidate's ranks are counted toward CHA here
 * (its default governing ability); its STR alternative is documented as a
 * spending option, not tracked as a separate attribution, since pf1 has no
 * per-rank "which pool paid for this" data to read.
 *
 * @param {pf1.documents.ActorPF} actor
 * @param {string} abilityId
 */
function sumRanksGovernedBy(actor, abilityId) {
  let total = 0;
  for (const [id, skill] of Object.entries(actor.system.skills ?? {})) {
    const governingAbility = skill?.ability || pf1.config.skills?.[id]?.ability;
    if (governingAbility !== abilityId) continue;
    total += skill?.rank ?? 0;
    for (const sub of Object.values(skill?.subSkills ?? {})) {
      total += sub?.rank ?? 0;
    }
  }
  return total;
}
