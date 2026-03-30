/** Shared OJT log (localStorage) — entries with id; open sessions allowed (time in only, time out later) */

const OJT_LOG_STORAGE_KEY = "ojt_log_entries_v2";
const OJT_LOG_LEGACY_KEY = "ojt_log_entries_v1";

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

function ojtSaveEntriesLocal(entries) {
  localStorage.setItem(ojtUserScopedKey(OJT_LOG_STORAGE_KEY), JSON.stringify(entries));
}

function ojtPersistEntriesToServer(entries) {
  if (!ojtAuthUserId()) return;
  const payload = { entries };

  // Fire-and-forget; UI stays responsive. Scoped to session user on the server.
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
  if (!ojtAuthUserId()) return;
  const local = ojtLoadEntries(); // may migrate legacy

  try {
    const res = await fetch("/api/entries/", {
      method: "GET",
      credentials: "same-origin",
    });
    if (res.status === 401) return;
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
  // Persist full state so delete is reflected server-side for the signed-in user.
  ojtPersistEntriesToServer(entries);
  if (typeof ojtSyncScheduleEndDateToProjection === "function") ojtSyncScheduleEndDateToProjection();
}

function ojtMinutesFromTime(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Stored "HH:MM" → parts for 12h UI: hour 1–12, minutes "00"-"59", "AM"|"PM". */
function ojtTime24hTo12hParts(timeStr) {
  const s = String(timeStr || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: "", mm: "", ap: "AM" };
  let hh = Number(m[1]);
  const mm = String(m[2]).padStart(2, "0");
  if (Number.isNaN(hh) || hh < 0 || hh > 23) return { h: "", mm: "", ap: "AM" };
  const isPm = hh >= 12;
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return { h: String(h12), mm, ap: isPm ? "PM" : "AM" };
}

/** 12h UI → stored "HH:MM" or null if invalid. Empty minutes defaults to 00. Hour 00 = 12. */
function ojtTime12hPartsTo24h(hourStr, minuteStr, ap) {
  let h = parseInt(String(hourStr ?? "").trim(), 10);
  const mmRaw = String(minuteStr ?? "").trim();
  const mm = mmRaw === "" ? 0 : parseInt(mmRaw, 10);
  const apu = String(ap ?? "AM").toUpperCase();
  if (Number.isNaN(h)) return null;
  if (h === 0) h = 12;
  if (h < 1 || h > 12) return null;
  if (Number.isNaN(mm) || mm < 0 || mm > 59) return null;
  let hh24;
  if (apu === "AM") hh24 = h === 12 ? 0 : h;
  else if (apu === "PM") hh24 = h === 12 ? 12 : h + 12;
  else return null;
  return `${String(hh24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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

/** Records backup: same shape the Import action expects (and optional raw array). */
const OJT_RECORDS_JSON_VERSION = 1;

function ojtNormalizeTimeHm(s) {
  const m = String(s ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || h < 0 || h > 23 || Number.isNaN(min) || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function ojtExportEntriesJson() {
  const entries = ojtLoadEntries();
  const payload = {
    format: "ojt-hours-records",
    version: OJT_RECORDS_JSON_VERSION,
    exportedAt: new Date().toISOString(),
    entries: entries.map((e) => ({
      id: e.id,
      date: e.date,
      timeIn: e.timeIn,
      timeOut: e.timeOut ?? null,
      hours: e.hours ?? null,
    })),
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const name = `ojt-records-${ojtTodayDateString()}.json`;
  if (typeof ojtTriggerFileDownload === "function") {
    ojtTriggerFileDownload(blob, name, "application/json");
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ojtNormalizeImportedEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const date = String(raw.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timeIn = ojtNormalizeTimeHm(raw.timeIn);
  if (!timeIn) return null;
  const toutRaw = raw.timeOut;
  const timeOut =
    toutRaw == null || toutRaw === "" ? null : ojtNormalizeTimeHm(toutRaw);
  if (toutRaw != null && toutRaw !== "" && !timeOut) return null;
  let id = raw.id != null ? String(raw.id).trim() : "";
  if (!id) id = ojtNewId();
  let hours = null;
  if (timeOut) {
    hours = ojtComputeHoursBetween(timeIn, timeOut);
    if (hours == null) return null;
  }
  return { id, date, timeIn, timeOut, hours };
}

function ojtParseImportRecordsJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "This file is not valid JSON." };
  }
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.entries)) list = data.entries;
  else {
    return {
      ok: false,
      message: 'Expected a JSON array of records, or an object with an "entries" array.',
    };
  }
  const normalized = [];
  let skipped = 0;
  for (const item of list) {
    const row = ojtNormalizeImportedEntry(item);
    if (row) normalized.push(row);
    else skipped += 1;
  }
  if (normalized.length === 0) {
    return {
      ok: false,
      message:
        skipped > 0
          ? "No valid records found. Use dates YYYY-MM-DD and times HH:MM (24-hour)."
          : "No records in file.",
    };
  }
  return { ok: true, entries: normalized, skipped };
}

function ojtMergeImportIntoEntries(imported) {
  const existing = ojtLoadEntries();
  const byId = new Map(existing.map((e) => [String(e.id), { ...e }]));
  for (const row of imported) {
    byId.set(String(row.id), row);
  }
  const merged = Array.from(byId.values());
  merged.sort((a, b) => {
    const c = ojtCompareDateStr(b.date, a.date);
    if (c !== 0) return c;
    return String(b.timeIn || "").localeCompare(String(a.timeIn || ""));
  });
  ojtSaveEntries(merged);
  return { count: merged.length, imported: imported.length };
}
