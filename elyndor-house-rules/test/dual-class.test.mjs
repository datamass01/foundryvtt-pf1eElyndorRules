/**
 * Quench test batch for the Primary/Secondary dual-class mechanics.
 *
 * Modeled on pf1's own test pattern (RefCode/module/test/actor-classes.test.mjs,
 * quench.registerBatch + createTestActor/addCompendiumItemToActor), but
 * written against only PUBLIC Foundry/pf1 APIs — per
 * RefCode/docs/API.md ("never import pf1 system JS files"), this module
 * does not import pf1's own internal `test/actor-utils.mjs` helpers and
 * instead defines its own minimal equivalents below.
 *
 * NOT YET RUN: this requires a live Foundry v14 + pf1 v11.11 world with the
 * Quench module installed and enabled (see the module README's "Dev setup"
 * section) — it has not been executed in this environment. Treat it as the
 * starting point for the Phase 1 spike validation the plan calls for, not
 * as evidence the mechanics already work.
 */
import { MODULE_ID } from "../scripts/const.mjs";
import { setClassRole } from "../scripts/class-roles.mjs";
import { totalSkillPointsPerLevel } from "../scripts/lib/formulas.mjs";

/** Create a throwaway PC actor for testing. */
async function createTestActor() {
  return Actor.create({ name: "Elyndor Test Actor", type: "character" });
}

/** Add a copy of a named Item from a pf1 core compendium onto an actor. */
async function addCoreClass(actor, className) {
  const pack = game.packs.get("pf1.classes");
  const index = await pack.getIndex();
  const entry = index.find((e) => e.name === className);
  if (!entry) throw new Error(`Class "${className}" not found in pf1.classes`);
  const source = await pack.getDocument(entry._id);
  const [created] = await actor.createEmbeddedDocuments("Item", [source.toObject()]);
  return created;
}

export function registerDualClassTests() {
  quench.registerBatch(
    "elyndor-house-rules.dual-class",
    async (context) => {
      const { describe, it, expect, before, after } = context;

      describe("Fighter (Primary) + Sorcerer (Secondary) @ level 5", () => {
        /** @type {pf1.documents.ActorPF} */
        let actor;
        let fighter;
        let sorcerer;

        before(async () => {
          actor = await createTestActor();
          fighter = await addCoreClass(actor, "Fighter");
          sorcerer = await addCoreClass(actor, "Sorcerer");
          await fighter.update({ "system.level": 5 });
          await sorcerer.update({ "system.level": 5 });
          await setClassRole(fighter, "primary");
          await setClassRole(sorcerer, "secondary");
        });

        after(async () => {
          await actor.delete();
        });

        it("BAB comes from Fighter only", () => {
          // Fighter (high BAB) @5 = 5; Sorcerer (low BAB) @5 would be 2 if it contributed.
          // Secondary babBase is zeroed at the source so it awards no BAB Change.
          expect(sorcerer.system.babBase).to.equal(0);
          expect(actor.system.attributes.bab.total).to.equal(5);
        });

        it("HP includes both classes' max hit dice", () => {
          // This is a sanity check on the *shape* of the total, not an exact
          // number — exact max-HP math depends on the world's health config
          // (see pf1's healthConfig setting) and CON score of the test
          // actor, which isn't pinned here.
          expect(actor.system.attributes.hp.max).to.be.greaterThan(0);
        });

        it("base saves pick max(Primary @5, Secondary @3), not the sum", () => {
          // Secondary save bases are the lagged table (Sorcerer as if level 3),
          // not the lockstep level-5 table, and they are not added on top of
          // Fighter's bases.
          expect(sorcerer.system.savingThrows.fort.base).to.equal(1);
          expect(sorcerer.system.savingThrows.ref.base).to.equal(1);
          expect(sorcerer.system.savingThrows.will.base).to.equal(3);

          const { str, dex, con, int, wis, cha } = actor.system.abilities;
          // Fort: max(Fighter@5 high=4, Sorcerer@3 low=1) = 4; + CON + STR.
          expect(actor.system.attributes.savingThrows.fort.total).to.equal(4 + con.mod + str.mod);
          // Ref: max(Fighter@5 poor=1, Sorcerer@3 poor=1) = 1; + DEX + INT.
          expect(actor.system.attributes.savingThrows.ref.total).to.equal(1 + dex.mod + int.mod);
          // Will: max(Fighter@5 poor=1, Sorcerer@3 high=3) = 3; + WIS + CHA.
          expect(actor.system.attributes.savingThrows.will.total).to.equal(3 + wis.mod + cha.mod);
        });

        it("feat count is 1 per character level, not 1 per odd level", () => {
          expect(actor.getFeatCount().max).to.equal(5);
        });

        it("Hit Dice do not double (equal true character level, not Primary+Secondary levels)", () => {
          // This is the root-cause fix (scripts/changes/character-level.mjs):
          // pf1 sums every class item's own hitDice/level, which would
          // otherwise be 5+5=10 here. Everything downstream that reads these
          // two fields (CON's contribution to HP, natural rest-healing,
          // getFeatCount() above) is only correct because this holds.
          expect(actor.system.attributes.hd.total).to.equal(5);
          expect(actor.system.details.level.value).to.equal(5);
        });
      });

      describe("Single-class actor (race-locked build, no Secondary, no role assigned)", () => {
        // Some Elyndor races grant everything from one class outright, so
        // the character never goes through the Primary/Secondary toggle at
        // all — getPrimaryClass() must still resolve this sole class item
        // as Primary (class-roles.mjs) so §2.2 skill points and §4.1 feat
        // count apply instead of silently falling back to core pf1 math.
        /** @type {pf1.documents.ActorPF} */
        let actor;
        let rogue;

        before(async () => {
          actor = await createTestActor();
          // Rogue's skillsPerLevel (8) deliberately differs from the
          // Elyndor flat pool (2) so a fresh (all mod-0) actor's native-pf1
          // total (max(1, 8+0)*5 = 40) and Elyndor total (2*5 = 10) can't
          // coincidentally match — unlike e.g. Fighter (2), which would.
          rogue = await addCoreClass(actor, "Rogue");
          await rogue.update({ "system.level": 5 });
          // Deliberately no setClassRole() call here.
        });

        after(async () => {
          await actor.delete();
        });

        it("feat count is still 1 per character level", () => {
          expect(actor.getFeatCount().max).to.equal(5);
        });

        it("skill ranks come from the §2.2 ability-pool total, not pf1's native per-class formula", () => {
          expect(actor.system.details.skills.bonus).to.equal(totalSkillPointsPerLevel(actor) * 5);
        });
      });

      describe("Secondary-eligibility guard", () => {
        let actor;
        let paladin;

        before(async () => {
          actor = await createTestActor();
          paladin = await addCoreClass(actor, "Paladin"); // casting.offset: -3, a late starter.
        });

        after(async () => {
          await actor.delete();
        });

        it("refuses to mark a late-starting caster as Secondary", async () => {
          await setClassRole(paladin, "secondary");
          expect(paladin.getFlag(MODULE_ID, "role")).to.be.undefined;
        });
      });
    },
    { displayName: "Elyndor House Rules: Dual-Class Mechanics" },
  );
}
