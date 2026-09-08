/**
 * Injects the Primary/Secondary designation control into the class Item
 * Sheet (`ClassSheetPF`) — see Docs/house-rules and the plan's "Primary/
 * Secondary Designation UX" section for why this lives on the class item
 * rather than the actor sheet.
 *
 * ApplicationV2 sheets re-render their whole window content on most data
 * changes, so this hook re-injects the control on every render rather than
 * trying to persist a DOM node across renders.
 */
import { MODULE_ID } from "../const.mjs";
import { getClassRole, isEligibleSecondary, setClassRole } from "../class-roles.mjs";

const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/class-role-toggle.hbs`;
const INJECTED_CLASS = `${MODULE_ID}-role-toggle`;

export function registerClassRoleToggle() {
  // CORRECTION (verified live): there is no `ClassSheetPF` in the installed
  // v11.11 build — every Item type (class included) shares one generic
  // `ItemSheetPF` (confirmed via `item.sheet.constructor.name`), so the
  // real render hook is `renderItemSheetPF`. Since that now fires for every
  // item type, onRenderClassSheet below additionally filters on
  // `item.type === "class"` (harmless no-op if RefCode's dev branch and a
  // future pf1 release do reintroduce a dedicated class sheet subclass).
  Hooks.on("renderItemSheetPF", onRenderClassSheet);
}

/**
 * @param {pf1.applications.item.ItemSheetPF} app
 * @param {HTMLElement|JQuery} html
 */
async function onRenderClassSheet(app, html) {
  const item = app.document ?? app.item;
  if (item?.type !== "class") return; // This hook now fires for every item type — classes only.
  if (!item?.actor) return; // Only meaningful once the class item is embedded on an actor.

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  // CORRECTION (verified live): on the item's *first* render, `root` is the
  // outer application element and `.window-content` is a descendant of it,
  // so `root.querySelector(".window-content")` finds it. But on every
  // re-render after that (e.g. the automatic re-render `setClassRole`'s
  // flag write triggers), pf1 hands this hook just the `<form>` itself —
  // `.window-content`'s *child*, not an ancestor containing it — so that
  // same querySelector call found nothing and silently fell back to `root`
  // (the form). Prepending the toggle into the form made it a CSS Grid item
  // alongside the sheet's header/sidebar/nav/body (the form is
  // `display:grid`), which starved it down to a min-content column and
  // pushed the real grid areas around — the shrinking fieldset and the nav
  // tabs "growing" the user saw. `.closest()` first handles root already
  // *being* window-content or nested inside it (covers both the form-only
  // re-render and the window-content-itself case); the `.querySelector()`
  // fallback keeps the original outer-wrapper case working. Everything
  // below is scoped off this same resolved `anchor` rather than off `root`
  // directly, so the stale-node cleanup keeps finding a toggle prepended on
  // an earlier (outer-wrapper) render even when this render's `root` is the
  // narrower form.
  const anchor = root.closest(".window-content") ?? root.querySelector(".window-content") ?? root;
  anchor.querySelector(`.${INJECTED_CLASS}`)?.remove();

  const role = getClassRole(item);
  const content = await renderTemplate(TEMPLATE_PATH, {
    role,
    isPrimary: role === "primary",
    isSecondary: role === "secondary",
    eligibleSecondary: isEligibleSecondary(item),
  });

  const wrapper = document.createElement("div");
  wrapper.innerHTML = content;
  const section = wrapper.firstElementChild;
  if (!section) return;
  section.classList.add(INJECTED_CLASS);

  anchor.prepend(section);

  section.querySelectorAll("input[type=radio]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const value = event.currentTarget.value || null;
      setClassRole(item, value);
    });
  });
}
