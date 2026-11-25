// Branded transitions (wipes) and full-screen timing, shared by the control
// panel and the overlay. Everything is scheduled on the server's clock: a wipe
// starts at `at`, fully covers the screen at its midpoint, and a full-screen
// (or an OBS scene switch) changes at that midpoint so the change is hidden.

export const WIPES = [['slash', 'Slash'], ['stripes', 'Stripes'], ['iris', 'Iris']];
export const WIPE_SPEEDS = [['normal', 'Normal (1.4 s)'], ['fast', 'Fast (1 s)']];
const WIPE_MS = {normal: 1400, fast: 1000};

// Overlays check for changes about every 0.8 s, so a wipe is scheduled a
// little ahead. An overlay that hears about it late starts partway through and
// still covers the screen at the same moment.
export const LEAD_MS = 1000;

export const wipeMs = speed => WIPE_MS[speed] || WIPE_MS.normal;
export const coverAt = transition => transition.at + wipeMs(transition.speed) / 2;
export const wipeOver = (transition, now) => !transition || now > transition.at + wipeMs(transition.speed) + 200;

export function newTransition(style, now, side, id) {
  const kind = WIPES.some(([value]) => value === style?.wipe) ? style.wipe : 'slash';
  const speed = WIPE_MS[style?.wipeSpeed] ? style.wipeSpeed : 'normal';
  return {id, style: kind, speed, side: [0, 1].includes(side) ? side : -1, at: Math.round(now + LEAD_MS)};
}

// A full-screen shows from showAt until hideAt (0 = until cleared).
export function fullUp(full, now) {
  return Boolean(full && now >= (full.showAt || 0) && !(full.hideAt && now >= full.hideAt));
}
