// save.js — the localStorage save game for Port Azura: cash, story progress
// and where Rook was standing, so Continue on the start screen picks the
// game up where it was left.

const SAVE_KEY = 'port-azura-sunset-heat-v1';

/** Read the save, or null when there is none (or it is unreadable). */
export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || data.v !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

/** Write the save. Silently does nothing when storage is unavailable. */
export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, ...data }));
  } catch {
    // Private mode or a full store: the game simply runs unsaved.
  }
}

/** Delete the save (New Game). */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
