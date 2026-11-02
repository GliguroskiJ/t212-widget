'use strict';
// Sidebar order + hidden tabs. Pure helpers shared by the app window and scripts/test-navorder.js.
// `nav` is NAV(): [[key, label, icon], …] in the default order. `order` / `hidden` are the saved
// settings (navOrder / navHidden): arrays of keys, [] = default.

const LOCKED = ['overview'];            // always visible, so the menu can never end up empty

const keysOf = nav => nav.map(x => (Array.isArray(x) ? x[0] : x));

// Saved order merged with the current tabs: unknown / removed keys are dropped, duplicates too, and a
// tab added in a later version lands at its default place — right after its nearest default predecessor
// that is already placed (or before its nearest successor), never just dumped at the end.
function mergeOrder(defaults, order) {
  const def = keysOf(defaults);
  const known = new Set(def);
  const out = [];
  for (const k of Array.isArray(order) ? order : []) if (known.has(k) && !out.includes(k)) out.push(k);
  if (!out.length) return def.slice();
  def.forEach((k, i) => {
    if (out.includes(k)) return;
    for (let j = i - 1; j >= 0; j--) {
      const at = out.indexOf(def[j]);
      if (at >= 0) { out.splice(at + 1, 0, k); return; }
    }
    for (let j = i + 1; j < def.length; j++) {
      const at = out.indexOf(def[j]);
      if (at >= 0) { out.splice(at, 0, k); return; }
    }
    out.push(k);
  });
  return out;
}

const isHidden = (key, hidden) => !LOCKED.includes(key) && Array.isArray(hidden) && hidden.includes(key);

// All tabs in the user's order, each { key, label, icon, hidden, locked } — for the editor.
function navItems(nav, order, hidden) {
  const by = new Map(nav.map(x => [x[0], x]));
  return mergeOrder(nav, order).map(k => {
    const [key, label, icon] = by.get(k);
    return { key, label, icon, hidden: isHidden(k, hidden), locked: LOCKED.includes(k) };
  });
}

// What the sidebar shows: NAV() entries in the user's order, hidden ones left out.
function visibleNav(nav, order, hidden) {
  const by = new Map(nav.map(x => [x[0], x]));
  return mergeOrder(nav, order).filter(k => !isHidden(k, hidden)).map(k => by.get(k));
}

// Move `key` to index `to` of the full order; returns the order to save ([] when it equals the default).
function moveKey(nav, order, key, to) {
  const cur = mergeOrder(nav, order);
  const from = cur.indexOf(key);
  if (from < 0) return normOrder(nav, cur);
  cur.splice(from, 1);
  cur.splice(Math.max(0, Math.min(cur.length, to)), 0, key);
  return normOrder(nav, cur);
}

const normOrder = (nav, order) => { const def = keysOf(nav); return order.join() === def.join() ? [] : order; };

// Toggle visibility; returns the hidden list to save (locked tabs can't be hidden).
function toggleHidden(hidden, key, hide) {
  const h = (Array.isArray(hidden) ? hidden : []).filter(k => k !== key);
  if (hide && !LOCKED.includes(key)) h.push(key);
  return h;
}

module.exports = { LOCKED, mergeOrder, navItems, visibleNav, moveKey, toggleHidden, isHidden };
