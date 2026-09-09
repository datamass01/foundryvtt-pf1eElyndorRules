/**
 * Small prototype-patching helpers shared by the house-rule files that
 * need to run code after one of pf1's own document/sheet methods returns
 * (rather than emitting a Change), because what they're correcting isn't
 * expressed as a Change in the first place — see changes/saves-bab-lag.mjs
 * and changes/skill-points-total.mjs's `registerSkillRankSuppression` for
 * why an additive-cancel Change is the wrong tool for those corrections.
 */

/**
 * Call `after` once the original method returns. Assigns an own property
 * on `proto` so inherited methods on a parent class are left intact.
 *
 * @param {object} proto
 * @param {string} method
 * @param {(this: object, ...args: unknown[]) => void} after
 */
export function wrapAfter(proto, method, after) {
  const original = proto?.[method];
  if (typeof original !== "function") return;
  proto[method] = function (...args) {
    const result = original.apply(this, args);
    after.call(this, ...args);
    return result;
  };
}

/**
 * Walk the prototype chain from `start` and wrap the first own `method`.
 *
 * @param {object} start
 * @param {string} method
 * @param {(this: object, ...args: unknown[]) => void} after
 */
export function wrapOwnAfter(start, method, after) {
  let proto = start;
  while (proto && proto !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, method)) {
      wrapAfter(proto, method, after);
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }
}
