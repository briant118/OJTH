/** Saved OJT plan (required before Time in/out) — localStorage */
const OJT_SCHEDULE_KEY = "ojt_schedule_v1";
/** Saved plan list (for "file folder" plan list) — localStorage */
const OJT_SCHEDULE_LIST_KEY = "ojt_schedule_list_v1";
/** Currently active plan id — localStorage */
const OJT_SCHEDULE_ACTIVE_ID_KEY = "ojt_schedule_active_id_v1";

function ojtAuthUserId() {
  try {
    const uid = typeof window !== "undefined" && window.OJT_AUTH_USER_ID ? String(window.OJT_AUTH_USER_ID) : "";
    return uid || "";
  } catch {
    return "";
  }
}

function ojtScheduleUserScopedKey(baseKey) {
  const uid = ojtAuthUserId();
  if (!uid) return baseKey;
  return `${baseKey}_user_${uid}`;
}

function ojtNewScheduleId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `s_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

/** Valid saved plan: dates + hours + non-empty assigned office */
function ojtScheduleIsComplete(data) {
  if (!data || !data.startDate || data.totalHours == null || data.totalHours === "") return false;
  const office = String(data.assignedOffice || "").trim();
  return office.length > 0;
}

function ojtNormalizeScheduleForStorage(data) {
  const out = { ...(data || {}) };
  if (!out.id) out.id = ojtNewScheduleId();
  if (!out.savedAt) out.savedAt = new Date().toISOString();
  return out;
}

function ojtReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function ojtWriteJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ojtSeedScheduleListFromActiveIfNeeded() {
  const list = ojtReadJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), []);
  if (Array.isArray(list) && list.length > 0) return;

  const active = ojtReadJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY), null);
  if (!active || !ojtScheduleIsComplete(active)) return;

  const normalized = ojtNormalizeScheduleForStorage(active);
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY), normalized);
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY), normalized.id);
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), [normalized]);
}

function ojtGetSchedule() {
  try {
    const raw = localStorage.getItem(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!ojtScheduleIsComplete(data)) return null;

    // Older versions might have no `id`. Normalize and persist so edits update the same entry.
    const normalized = ojtNormalizeScheduleForStorage(data);
    if (normalized.id !== data.id || normalized.savedAt !== data.savedAt) {
      ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY), normalized);
      if (normalized.id) ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY), normalized.id);
    }
    return normalized;
  } catch {
    return null;
  }
}

function ojtUpsertScheduleToList(schedule) {
  const list = ojtReadJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), []);
  const arr = Array.isArray(list) ? list : [];
  const idx = arr.findIndex((x) => x?.id && x.id === schedule.id);
  if (idx >= 0) arr[idx] = schedule;
  else arr.push(schedule);
  arr.sort((a, b) => String(b?.savedAt || "").localeCompare(String(a?.savedAt || "")));
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), arr);
}

function ojtGetSchedules() {
  ojtSeedScheduleListFromActiveIfNeeded();
  const list = ojtReadJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), []);
  if (!Array.isArray(list)) return [];

  // Normalize saved list items so older localStorage data (missing `id`) can still be deleted.
  const complete = list.filter((p) => ojtScheduleIsComplete(p));
  let changed = false;

  const normalized = complete.map((p) => {
    const needsId = !p?.id;
    const needsSavedAt = !p?.savedAt;
    if (!needsId && !needsSavedAt) return p;
    changed = true;
    return ojtNormalizeScheduleForStorage(p);
  });

  normalized.sort((a, b) => String(b?.savedAt || "").localeCompare(String(a?.savedAt || "")));

  if (changed) {
    ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), normalized);
  }

  return normalized;
}

function ojtSaveSchedule(payload) {
  const active = payload ? { ...(payload || {}) } : {};
  const normalized = ojtNormalizeScheduleForStorage(active);

  // Ensure list contains this plan too.
  ojtUpsertScheduleToList(normalized);
  // Mark as active and keep the legacy single-plan key for gate logic.
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY), normalized);
  if (normalized.id) ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY), normalized.id);
}

function ojtClearScheduleStorage() {
  // Keep the "folder list"; just clear the currently active schedule.
  localStorage.removeItem(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY));
  localStorage.removeItem(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY));
}

function ojtGetActiveScheduleId() {
  const id = localStorage.getItem(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY));
  return id ? String(id) : null;
}

function ojtLoadScheduleById(id) {
  if (!id) return null;
  const schedules = ojtGetSchedules();
  const found = schedules.find((s) => s?.id === id);
  if (!found) return null;
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY), found);
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY), found.id);
  return found;
}

function ojtDeleteScheduleById(id) {
  if (!id) return false;
  const schedules = ojtGetSchedules();
  const next = schedules.filter((s) => s?.id !== id);
  const removed = next.length !== schedules.length;

  if (!removed) return false;
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), next);

  // Prevent re-seeding: if we removed the last saved plan from the list,
  // clear the "active" schedule keys too (otherwise the seed helper can repopulate the list).
  //
  // Also clear active if this deleted id matches the currently active schedule.
  const activeId = ojtGetActiveScheduleId();
  const active = ojtGetSchedule();
  if (next.length === 0 || activeId === id || active?.id === id) {
    ojtClearScheduleStorage();
  }
  return true;
}

function ojtHasSchedule() {
  return ojtGetSchedule() != null;
}

// Backwards compatibility: callers sometimes only use the single active key.
// `ojtGetSchedules()` + `ojtDeleteScheduleById()` are new helpers for the plan list UI.
