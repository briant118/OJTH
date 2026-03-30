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
  ojtPersistScheduleToServer();
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
  ojtPersistScheduleToServer();
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
  ojtPersistScheduleToServer();
  return true;
}

function ojtHasSchedule() {
  return ojtGetSchedule() != null;
}

// Backwards compatibility: callers sometimes only use the single active key.
// `ojtGetSchedules()` + `ojtDeleteScheduleById()` are new helpers for the plan list UI.

function ojtSerializeScheduleState() {
  ojtSeedScheduleListFromActiveIfNeeded();
  return {
    plans: ojtGetSchedules(),
    activePlanId: ojtGetActiveScheduleId(),
  };
}

function ojtApplyScheduleStateFromServer(data) {
  if (!data || typeof data !== "object") return;
  const plans = Array.isArray(data.plans) ? data.plans.filter((p) => p && ojtScheduleIsComplete(p)) : [];
  const activePlanId =
    data.activePlanId != null && data.activePlanId !== "" ? String(data.activePlanId) : null;

  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_LIST_KEY), plans);

  if (plans.length === 0) {
    localStorage.removeItem(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY));
    localStorage.removeItem(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY));
    return;
  }

  let active = activePlanId ? plans.find((p) => p && p.id === activePlanId) : null;
  if (!active) active = plans[0];
  if (!active || !ojtScheduleIsComplete(active)) return;

  const normalized = ojtNormalizeScheduleForStorage(active);
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_KEY), normalized);
  ojtWriteJson(ojtScheduleUserScopedKey(OJT_SCHEDULE_ACTIVE_ID_KEY), normalized.id);
}

function ojtPersistScheduleToServer() {
  if (typeof ojtAuthUserId !== "function" || !ojtAuthUserId()) return;
  const { plans, activePlanId } = ojtSerializeScheduleState();
  fetch("/api/schedule/sync/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plans,
      activePlanId: activePlanId || null,
    }),
    credentials: "same-origin",
  }).catch(() => {});
}

async function ojtSyncScheduleFromServer() {
  if (typeof ojtAuthUserId !== "function" || !ojtAuthUserId()) return;
  const local = ojtSerializeScheduleState();

  try {
    const res = await fetch("/api/schedule/", {
      method: "GET",
      credentials: "same-origin",
    });
    if (res.status === 401) return;
    if (!res.ok) return;
    const data = await res.json();
    const serverPlans = Array.isArray(data?.plans) ? data.plans : [];

    if (serverPlans.length === 0) {
      if (local.plans.length > 0) {
        ojtPersistScheduleToServer();
      }
      return;
    }

    ojtApplyScheduleStateFromServer(data);
  } catch {
    /* ignore */
  }
}

/** Local calendar YYYY-MM-DD (avoid UTC shift from toISOString). */
function ojtLocalYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * When you're behind (missed days / low hours), remaining hours need more calendar days
 * at your planned hours/day on working days only — same rules as the plan end calculator.
 *
 * @param {object} schedule — saved plan with hoursPerDay, workingDays, startDate
 * @param {number} remainingHours — target minus recorded (>= 0)
 * @param {string} fromDateStr — usually today YYYY-MM-DD; projection won't start before plan start
 * @returns {string|null} projected end date YYYY-MM-DD or null
 */
function ojtProjectedEndDateFromRemaining(schedule, remainingHours, fromDateStr) {
  if (!schedule || remainingHours == null || remainingHours <= 0) return null;
  const hpd = Number(schedule.hoursPerDay);
  let dows = Array.isArray(schedule.workingDays) ? schedule.workingDays : [];
  if (!dows.length) dows = [1, 2, 3, 4, 5];
  if (!hpd || hpd <= 0) return null;

  const planStart = String(schedule.startDate || "").trim();
  let startStr = String(fromDateStr || "").trim() || planStart;
  if (planStart && startStr < planStart) startStr = planStart;

  const cursor = new Date(`${startStr}T12:00:00`);
  if (Number.isNaN(cursor.getTime())) return null;

  let remaining = remainingHours;
  const allowed = new Set(dows);
  const MAX_DAYS = 365 * 20;

  for (let i = 0; i < MAX_DAYS; i++) {
    const dow = cursor.getDay();
    if (allowed.has(dow)) {
      remaining -= hpd;
      if (remaining <= 0) {
        return ojtLocalYmd(cursor);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

/** Plan end from start → total hours (same rules as Set schedule), no “from today” shift. */
function ojtScheduleTheoreticalEndDate(schedule) {
  if (!schedule) return null;
  const startStr = String(schedule.startDate || "").trim();
  const total = Number(schedule.totalHours) || 0;
  const hpd = Number(schedule.hoursPerDay) || 0;
  const dows = Array.isArray(schedule.workingDays) && schedule.workingDays.length ? schedule.workingDays : [1, 2, 3, 4, 5];
  if (!startStr || total <= 0 || hpd <= 0 || !dows.length) return null;
  let remaining = total;
  const cursor = new Date(`${startStr}T12:00:00`);
  if (Number.isNaN(cursor.getTime())) return null;
  const allowed = new Set(dows);
  const MAX_DAYS = 365 * 20;
  for (let i = 0; i < MAX_DAYS; i++) {
    const dow = cursor.getDay();
    if (allowed.has(dow)) {
      remaining -= hpd;
      if (remaining <= 0) return ojtLocalYmd(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

/**
 * After time in / out, move `schedule.endDate` to the projected finish (from today + remaining hours),
 * so the end date moves with logged time. With **no** recorded hours, resets to the theoretical plan end.
 */
function ojtSyncScheduleEndDateToProjection() {
  const s = ojtGetSchedule();
  if (!s) return;
  if (typeof ojtTotalRecordedHours !== "function") return;
  const target = Number(s.totalHours) || 0;
  const recorded = ojtTotalRecordedHours();
  const remaining = Math.max(0, target - recorded);

  if (recorded <= 0 && remaining > 0) {
    const theoretical = ojtScheduleTheoreticalEndDate(s);
    if (theoretical && theoretical !== s.endDate) {
      ojtSaveSchedule({ ...s, endDate: theoretical, savedAt: new Date().toISOString() });
    }
    return;
  }

  let newEnd = null;
  if (remaining <= 0) {
    if (typeof ojtTodayDateString === "function") newEnd = ojtTodayDateString();
  } else if (typeof ojtProjectedEndDateFromRemaining === "function") {
    const today = typeof ojtTodayDateString === "function" ? ojtTodayDateString() : "";
    newEnd = ojtProjectedEndDateFromRemaining(s, remaining, today);
  }
  if (!newEnd || newEnd === s.endDate) return;
  ojtSaveSchedule({ ...s, endDate: newEnd, savedAt: new Date().toISOString() });
}
