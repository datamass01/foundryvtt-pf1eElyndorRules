/**
 * Injects a Class Role column (None / Primary / Secondary) into the
 * character sheet's classes list on the Summary tab.
 *
 * pf1's own template (`character-summary.hbs`) has no extension point for
 * extra columns, so this re-injects on every `renderActorSheetPFCharacter`
 * — the same pattern as `skill-pool-panel.mjs`. The select is a convenience
 * for the same flag the class Item Sheet radio already writes
 * (`class-roles.mjs`); it is not a second source of truth.
 */
import { MODULE_ID, ROLE } from "../const.mjs";
import { getClassRole, isEligibleSecondary, setClassRole } from "../class-roles.mjs";

const COL_CLASS = `${MODULE_ID}-class-role`;

const ROLE_LABELS = {
  [ROLE.PRIMARY]: "ELYNDOR.ClassRole.Primary",
  [ROLE.SECONDARY]: "ELYNDOR.ClassRole.Secondary",
};

export function registerClassRoleColumn() {
  // Same live-verified sheet class as skill-pool-panel.mjs: the installed
  // v11.11 build's PC sheet is `ActorSheetPFCharacter`, not RefCode's
  // `CharacterSheetPF`.
  Hooks.on("renderActorSheetPFCharacter", onRenderCharacterSheet);
}

/**
 * @param {pf1.applications.actor.ActorSheetPFCharacter} app
 * @param {HTMLElement|JQuery} html
 */
function onRenderCharacterSheet(app, html) {
  const actor = app.document ?? app.actor;
  if (!actor) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const lists = root.querySelectorAll(".classes-body .item-list");
  if (!lists.length) return;

  const editable = app.isEditable !== false;

  for (const list of lists) {
    injectHeader(list);
    for (const row of list.querySelectorAll("li.item[data-item-id]")) {
      injectRow(row, actor, editable);
    }
  }
}

/** @param {Element} list */
function injectHeader(list) {
  const header = list.querySelector(".item-list-header");
  if (!header) return;
  header.querySelector(`.${COL_CLASS}`)?.remove();

  const cell = document.createElement("div");
  cell.className = `item-detail ${COL_CLASS}`;
  cell.textContent = game.i18n.localize("ELYNDOR.ClassRole.Column");
  insertBeforeLevel(header, cell);
}

/**
 * @param {Element} row
 * @param {pf1.documents.ActorPF} actor
 * @param {boolean} editable
 */
function injectRow(row, actor, editable) {
  row.querySelector(`.${COL_CLASS}`)?.remove();

  const item = actor.items.get(row.dataset.itemId);
  if (!item) return;

  const cell = document.createElement("div");
  cell.className = `item-detail ${COL_CLASS}`;

  const role = getClassRole(item);
  if (!editable) {
    cell.textContent = roleLabel(role);
  } else {
    cell.append(buildSelect(item, role));
  }

  insertBeforeLevel(row, cell);
}

/**
 * Place the new cell immediately before the Level column so the order is
 * Type (if present) → Class Role → Level → controls. Fall back to before
 * the edit-controls cluster, then append, if the Level column is missing.
 *
 * @param {Element} parent
 * @param {Element} cell
 */
function insertBeforeLevel(parent, cell) {
  const before =
    parent.querySelector(".item-feat-level") ?? parent.querySelector(".item-controls");
  if (before) before.before(cell);
  else parent.append(cell);
}

/**
 * @param {pf1.documents.ItemPF} item
 * @param {"primary"|"secondary"|null} role
 */
function buildSelect(item, role) {
  const select = document.createElement("select");
  // Disassociate from the actor-sheet <form> so a change can't be swept
  // into Foundry's submitOnChange payload as a phantom actor field.
  select.setAttribute("form", "");
  select.setAttribute("aria-label", game.i18n.localize("ELYNDOR.ClassRole.Column"));
  select.dataset.itemId = item.id;

  const options = [
    ["", "ELYNDOR.ClassRole.None"],
    [ROLE.PRIMARY, "ELYNDOR.ClassRole.Primary"],
    [ROLE.SECONDARY, "ELYNDOR.ClassRole.Secondary"],
  ];
  const eligibleSecondary = isEligibleSecondary(item);
  for (const [value, labelKey] of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = game.i18n.localize(labelKey);
    if ((role ?? "") === value) opt.selected = true;
    if (value === ROLE.SECONDARY && !eligibleSecondary) {
      opt.disabled = true;
      opt.title = game.i18n.localize("ELYNDOR.ClassRole.NotEligibleSecondaryHint");
    }
    select.append(opt);
  }

  // Keep row-level item actions (summary toggle, drag) from eating the click.
  select.addEventListener("pointerdown", (event) => event.stopPropagation());
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", async (event) => {
    event.stopPropagation();
    const value = event.currentTarget.value || null;
    const ok = await setClassRole(item, value);
    if (!ok) event.currentTarget.value = getClassRole(item) ?? "";
  });

  return select;
}

/** @param {"primary"|"secondary"|null} role */
function roleLabel(role) {
  const key = ROLE_LABELS[role] ?? "ELYNDOR.ClassRole.None";
  return game.i18n.localize(key);
}
