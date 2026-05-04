/** Shared OJT log (localStorage) — entries with id; open sessions allowed (time in only, time out later) */

const OJT_LOG_STORAGE_KEY = "ojt_log_entries_v2";
const OJT_LOG_LEGACY_KEY = "ojt_log_entries_v1";
const OJT_CLIENT_KEY_STORAGE_KEY = "ojt_client_key_v1";

function ojtAuthUserId() {
  try {
    const uid = typeof window !== "undefined" && window.OJT_AUTH_USER_ID ? String(window.OJT_AUTH_USER_ID) : "";
    return uid || "";
  } catch {
    return "";
  }
}

function ojtUserScopedKey(baseKey) {
  const uid = ojtAuthUserId();
  if (!uid) return baseKey;
  return `${baseKey}_user_${uid}`;
}

function ojtClientKeyStorageKey() {
  // If logged in, namespace the key by user id to isolate data per account.
  return ojtUserScopedKey(OJT_CLIENT_KEY_STORAGE_KEY);
}

function ojtGetClientKey() {
  try {
    const storageKey = ojtClientKeyStorageKey();
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const k = ojtNewId();
    localStorage.setItem(storageKey, k);
    return k;
  } catch {
    // Fallback (should not happen in normal browser use).
    return "client_fallback";
  }
}

function ojtSaveEntriesLocal(entries) {
  localStorage.setItem(ojtUserScopedKey(OJT_LOG_STORAGE_KEY), JSON.stringify(entries));
}

function ojtPersistEntriesToServer(entries) {
  const clientKey = ojtGetClientKey();
  const payload = { clientKey, entries };

  // Fire-and-forget; UI stays responsive.
  fetch("/api/entries/sync/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "same-origin",
  }).catch(() => {});
}

/**
 * Fetch latest entries from server and overwrite localStorage.
 * If server returns empty but localStorage has entries, we push local to server instead.
 */
async function ojtSyncEntriesFromServer() {
  const clientKey = ojtGetClientKey();
  const local = ojtLoadEntries(); // may migrate legacy

  try {
    const res = await fetch(`/api/entries/?clientKey=${encodeURIComponent(clientKey)}`, {
      method: "GET",
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const data = await res.json();
    const serverEntries = Array.isArray(data?.entries) ? data.entries : [];

    if (serverEntries.length === 0) {
      if (local.length > 0) {
        ojtPersistEntriesToServer(local);
      }
      return;
    }

    // Normalize nulls into expected shapes.
    const normalized = serverEntries.map((e) => ({
      id: e.id,
      date: e.date,
      timeIn: e.timeIn ?? null,
      timeOut: e.timeOut ?? null,
      hours: e.hours ?? null,
    }));
    ojtSaveEntriesLocal(normalized);
  } catch {
    // Network/server errors should not break the app.
  }
}

function ojtNewId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function ojtMigrateLegacyV1() {
  try {
    const legacyKey = ojtUserScopedKey(OJT_LOG_LEGACY_KEY);
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return;
    const v2 = arr.map((e) => ({
      id: ojtNewId(),
      date: e.date,
      timeIn: e.timeIn || null,
      timeOut: e.timeOut || null,
      hours:
        e.timeIn && e.timeOut
          ? ojtComputeHoursBetween(e.timeIn, e.timeOut)
          : e.hours ?? null,
    }));
    localStorage.setItem(ojtUserScopedKey(OJT_LOG_STORAGE_KEY), JSON.stringify(v2));
    localStorage.removeItem(legacyKey);
  } catch {
    /* ignore */
  }
}

function ojtLoadEntries() {
  ojtMigrateLegacyV1();
  try {
    const raw = localStorage.getItem(ojtUserScopedKey(OJT_LOG_STORAGE_KEY));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function ojtSaveEntries(entries) {
  ojtSaveEntriesLocal(entries);
  // Persist full state so delete is reflected server-side for this clientKey.
  ojtPersistEntriesToServer(entries);
}

function ojtMinutesFromTime(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function ojtNowTimeString() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function ojtTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/** Hours between time in and time out (supports overnight if out < in). */
function ojtComputeHoursBetween(timeIn, timeOut) {
  if (!timeIn || !timeOut) return null;
  const a = ojtMinutesFromTime(timeIn);
  const b = ojtMinutesFromTime(timeOut);
  if (a == null || b == null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

function ojtFormatHours(n) {
  if (n == null || Number.isNaN(n)) return "—";
  // Convert "hours" (float) into a fixed HH:MM:SS string.
  // Example: 0.42 hours ~= 25 minutes 12 seconds => "00:25:12"
  const totalSeconds = Math.round(Number(n) * 3600);
  const hoursTotal = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hoursTotal).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function ojtCompareDateStr(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function ojtEntryIsOpen(row) {
  return Boolean(row.timeIn) && !row.timeOut;
}

/** Create open session: time in set, time out null */
function ojtAddOpenEntry(date, timeIn) {
  if (!date || !timeIn) return { ok: false, message: "Date and time in are required." };
  const entries = ojtLoadEntries();
  const row = {
    id: ojtNewId(),
    date,
    timeIn,
    timeOut: null,
    hours: null,
  };
  entries.push(row);
  entries.sort((a, b) => {
    const c = ojtCompareDateStr(b.date, a.date);
    if (c !== 0) return c;
    return String(b.timeIn || "").localeCompare(String(a.timeIn || ""));
  });
  ojtSaveEntries(entries);
  return { ok: true, entry: row };
}

/** Update existing entry by id */
function ojtPatchEntry(id, patch) {
  const entries = ojtLoadEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return { ok: false, message: "Entry not found." };
  const row = { ...entries[idx], ...patch };
  if (row.timeIn && row.timeOut) {
    row.hours = ojtComputeHoursBetween(row.timeIn, row.timeOut);
  } else {
    row.hours = null;
  }
  entries[idx] = row;
  ojtSaveEntries(entries);
  return { ok: true, entry: row };
}

/** Set time out on an open entry; completes the session */
function ojtCompleteEntry(id, timeOut) {
  if (!timeOut) return { ok: false, message: "Enter time out." };
  const entries = ojtLoadEntries();
  const row = entries.find((e) => e.id === id);
  if (!row) return { ok: false, message: "Entry not found." };
  if (!row.timeIn) return { ok: false, message: "This entry has no time in." };
  return ojtPatchEntry(id, { timeOut });
}

function ojtDeleteEntryById(id) {
  const entries = ojtLoadEntries().filter((e) => e.id !== id);
  ojtSaveEntries(entries);
}

/** Save full row when both times provided (new or overwrite by id) */
function ojtSaveFullEntry({ id, date, timeIn, timeOut }) {
  if (!date || !timeIn || !timeOut) {
    return { ok: false, message: "Date, time in, and time out are required." };
  }
  const hours = ojtComputeHoursBetween(timeIn, timeOut);
  if (hours == null) return { ok: false, message: "Invalid times." };

  let entries = ojtLoadEntries();
  const newId = id || ojtNewId();
  const row = { id: newId, date, timeIn, timeOut, hours };
  const idx = entries.findIndex((e) => e.id === newId);
  if (idx >= 0) entries[idx] = row;
  else entries.push(row);
  entries.sort((a, b) => {
    const c = ojtCompareDateStr(b.date, a.date);
    if (c !== 0) return c;
    return String(b.timeIn || "").localeCompare(String(a.timeIn || ""));
  });
  ojtSaveEntries(entries);
  return { ok: true, entry: row };
}

function ojtEscapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}
