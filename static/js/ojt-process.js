/** Set schedule / plan — process.html only */

/** Map checkbox IDs to JS weekday: 0=Sun … 6=Sat */
const DAY_IDS = [
  { id: "workSun", dow: 0 },
  { id: "workMon", dow: 1 },
  { id: "workTue", dow: 2 },
  { id: "workWed", dow: 3 },
  { id: "workThu", dow: 4 },
  { id: "workFri", dow: 5 },
  { id: "workSat", dow: 6 },
];

// Editor mode:
// - "add": user clicked "Add new schedule" => we should create a NEW saved schedule id on save
// - "edit": user clicked "Edit" on a saved plan => save should overwrite the selected plan
let ojtScheduleEditorMode = "edit";
// Track which saved plan the user last loaded from the list.
// This makes the "Delete" button reliably delete that selected plan.
let ojtSelectedPlanId = null;

function ojtAskScheduleDelete(message) {
  const modalEl = $("scheduleDeleteConfirmModal");
  const bodyEl = $("scheduleDeleteConfirmBody");
  const okBtn = $("btnScheduleDeleteConfirmOk");
  const titleEl = $("scheduleDeleteConfirmTitle");

  if (!modalEl || !bodyEl || !okBtn || !titleEl || typeof bootstrap === "undefined") {
    return Promise.resolve(confirm(message));
  }

  bodyEl.textContent = message;

  const instance = bootstrap.Modal.getOrCreateInstance(modalEl);
  return new Promise((resolve) => {
    let decided = false;
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const onOk = () => {
      decided = true;
      // Resolve immediately; avoids edge-cases where hidden event doesn't fire.
      finish(true);
      instance.hide();
    };

    okBtn.addEventListener("click", onOk, { once: true });
    modalEl.addEventListener("hidden.bs.modal", () => finish(decided), { once: true });

    instance.show();
  });
}

function setWorkingDaysFromDows(selectedDows) {
  const set = new Set(selectedDows);
  for (const { id, dow } of DAY_IDS) {
    const cb = $(id);
    if (cb) cb.checked = set.has(dow);
  }
}

function getSelectedWorkingDows() {
  return DAY_IDS.filter(({ id }) => $(id)?.checked).map(({ dow }) => dow);
}

function getResolvedOffice() {
  return ($("assignedOffice")?.value || "").trim();
}

function wireDayPresets() {
  const bindPreset = (btnId, applyDays) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyDays();
      refreshPlanPreview();
    });
  };

  bindPreset("presetMonThu", () => setWorkingDaysFromDows([1, 2, 3, 4]));
  bindPreset("presetMonFri", () => setWorkingDaysFromDows([1, 2, 3, 4, 5]));
  bindPreset("presetEveryday", () => setWorkingDaysFromDows([0, 1, 2, 3, 4, 5, 6]));
  bindPreset("presetClearDays", () => setWorkingDaysFromDows([]));
}

function computeEndDate({ startDateStr, totalHours, hoursPerDay, workingDows }) {
  if (!startDateStr || totalHours <= 0 || hoursPerDay <= 0) return null;
  if (!workingDows.length) return null;

  const start = new Date(startDateStr + "T00:00:00");
  if (Number.isNaN(start.getTime())) return null;

  let remaining = totalHours;
  const cursor = new Date(start);
  const allowed = new Set(workingDows);

  const MAX_DAYS = 365 * 20;

  for (let i = 0; i < MAX_DAYS; i++) {
    const dow = cursor.getDay();
    if (allowed.has(dow)) {
      remaining -= hoursPerDay;
      if (remaining <= 0) {
        return { endDate: new Date(cursor) };
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return null;
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function refreshPlanPreview() {
  const startStr = $("startDate")?.value;
  const total = Number($("totalHours")?.value || 0);
  const hpd = Number($("hoursPerDay")?.value || 0);
  const dows = getSelectedWorkingDows();
  const office = getResolvedOffice();

  $("officePreview") && ($("officePreview").textContent = office || "—");
  $("startDatePreview") && ($("startDatePreview").textContent = startStr ? formatDate(new Date(startStr + "T00:00:00")) : "--/--/----");
  $("totalHoursPreview") && ($("totalHoursPreview").textContent = total.toFixed(2));

  const result = computeEndDate({
    startDateStr: startStr,
    totalHours: total,
    hoursPerDay: hpd,
    workingDows: dows,
  });

  const badge = $("planStatusBadge");
  if (result) {
    $("endDate") && ($("endDate").value = result.endDate.toISOString().slice(0, 10));
    $("endDatePreview") && ($("endDatePreview").textContent = formatDate(result.endDate));
    if (badge) {
      const savedText = ojtScheduleEditorMode === "edit" && ojtHasSchedule() ? "Saved" : "Ready";
      badge.textContent = savedText;
      badge.classList.remove("text-bg-secondary");
      badge.classList.add("text-bg-success");
    }
  } else {
    $("endDate") && ($("endDate").value = "");
    $("endDatePreview") && ($("endDatePreview").textContent = "--/--/----");
    if (badge) {
      badge.textContent = "Incomplete";
      badge.classList.remove("text-bg-success");
      badge.classList.add("text-bg-secondary");
    }
  }
}

function savePlanToStorage() {
  const startStr = $("startDate")?.value;
  const total = Number($("totalHours")?.value || 0);
  const hpd = Number($("hoursPerDay")?.value || 0);
  const dows = getSelectedWorkingDows();

  const office = getResolvedOffice();
  if (!office) {
    alert("Please enter your assigned office.");
    return false;
  }

  const result = computeEndDate({
    startDateStr: startStr,
    totalHours: total,
    hoursPerDay: hpd,
    workingDows: dows,
  });

  if (!result) {
    alert("Complete your plan: start date, total hours, hours per day, and at least one working day.");
    return false;
  }

  // If editing a saved plan, update the same entry. If adding new, omit id so a new one is generated.
  const active = ojtGetSchedule();
  const existingId = ojtScheduleEditorMode === "edit" ? active?.id || null : null;

  ojtSaveSchedule({
    id: existingId,
    assignedOffice: office,
    traineeName: ($("traineeName")?.value || "").trim(),
    startDate: startStr,
    totalHours: total,
    hoursPerDay: hpd,
    endDate: result.endDate.toISOString().slice(0, 10),
    workingDays: dows,
    note: $("planNote")?.value || "",
    savedAt: new Date().toISOString(),
  });

  const badge = $("planStatusBadge");
  if (badge) {
    badge.textContent = "Saved";
    badge.classList.remove("text-bg-secondary");
    badge.classList.add("text-bg-success");
  }
  return true;
}

function loadPlanFromStorage() {
  const s = ojtGetSchedule();
  if (!s) {
    if ($("assignedOffice")) $("assignedOffice").value = "";
    if ($("traineeName")) $("traineeName").value = "";
    const startEl = $("startDate");
    if (startEl) startEl.value = "";
    const totalEl = $("totalHours");
    if (totalEl) totalEl.value = "";
    const hpdEl = $("hoursPerDay");
    if (hpdEl) hpdEl.value = "";
    const noteEl = $("planNote");
    if (noteEl) noteEl.value = "";
    setWorkingDaysFromDows([]);
    refreshPlanPreview();
    return;
  }

  if ($("assignedOffice")) $("assignedOffice").value = s.assignedOffice || "";

  if ($("traineeName")) $("traineeName").value = s.traineeName || "";
  if ($("startDate")) $("startDate").value = s.startDate || "";
  if ($("totalHours")) $("totalHours").value = s.totalHours ?? "";
  if ($("hoursPerDay")) $("hoursPerDay").value = s.hoursPerDay ?? "";
  if ($("planNote")) $("planNote").value = s.note || "";
  setWorkingDaysFromDows(s.workingDays || []);
  refreshPlanPreview();
}

function loadPlanIntoForm(s) {
  if (!$("assignedOffice")) return;

  if ($("assignedOffice")) $("assignedOffice").value = s?.assignedOffice || "";
  if ($("traineeName")) $("traineeName").value = s?.traineeName || "";
  if ($("startDate")) $("startDate").value = s?.startDate || "";
  if ($("totalHours")) $("totalHours").value = s?.totalHours ?? "";
  if ($("hoursPerDay")) $("hoursPerDay").value = s?.hoursPerDay ?? "";
  if ($("planNote")) $("planNote").value = s?.note || "";

  setWorkingDaysFromDows(s?.workingDays || []);
  refreshPlanPreview();
}

function resetPlanFormForAdd() {
  if ($("assignedOffice")) $("assignedOffice").value = "";
  if ($("traineeName")) $("traineeName").value = "";
  const s = $("startDate");
  if (s) s.value = "";
  const th = $("totalHours");
  if (th) th.value = "";
  const hpd = $("hoursPerDay");
  if (hpd) hpd.value = "";
  const n = $("planNote");
  if (n) n.value = "";
  setWorkingDaysFromDows([]);
  refreshPlanPreview();
}

function renderPlanList() {
  const tbody = $("planTableBody");
  if (!tbody) return;

  const schedules = ojtGetSchedules?.() || [];
  const active = ojtGetSchedule();
  const activeId = active?.id;

  tbody.innerHTML = "";

  if (!schedules.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-secondary py-4">No plans yet.</td></tr>`;
    return;
  }

  const toLocaleDateCell = (ymd) => {
    if (!ymd) return "--/--/----";
    const d = new Date(ymd + "T00:00:00");
    if (Number.isNaN(d.getTime())) return ymd;
    return formatDate(d);
  };

  for (const plan of schedules) {
    const id = plan?.id || "";
    const isActive = activeId && id && String(activeId) === String(id);
    const badge = isActive ? `<span class="badge text-bg-primary ms-2">On-going</span>` : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="min-width: 130px;">
        <div class="d-flex flex-column">
          <span>${toLocaleDateCell(plan.startDate)}</span>
          ${badge}
        </div>
      </td>
      <td style="min-width: 130px;">${toLocaleDateCell(plan.endDate)}</td>
      <td class="text-end">${Number(plan.totalHours ?? 0).toFixed(2)}</td>
      <td>${plan.note ? String(plan.note) : "—"}</td>
    `;

    tr.addEventListener("click", (e) => {
      ojtSelectedPlanId = id;
      const loaded = ojtLoadScheduleById?.(id);
      if (!loaded) return;
      ojtScheduleEditorMode = "edit";
      loadPlanIntoForm(loaded);
      const modalEl = $("scheduleEditorModal");
      if (modalEl && typeof bootstrap !== "undefined") {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      }
      renderPlanList();
    });

    tbody.appendChild(tr);
  }
}

function wirePlanInputs() {
  ["assignedOffice", "startDate", "totalHours", "hoursPerDay", "planNote", "traineeName"].forEach((id) => {
    $(id)?.addEventListener("input", refreshPlanPreview);
  });
  DAY_IDS.forEach(({ id }) => $(id)?.addEventListener("change", refreshPlanPreview));
}

function wireSaveButtons() {
  $("btnSavePlan")?.addEventListener("click", async () => {
    try {
      const modalEl = $("scheduleEditorModal");
      const overlayEl = $("scheduleModalLoadingOverlay");
      const setScheduleLoading = (isLoading) => {
        if (overlayEl) overlayEl.classList.toggle("d-none", !isLoading);
        const saveBtn = $("btnSavePlan");
        const delBtn = $("btnClearPlan");
        if (saveBtn) saveBtn.disabled = isLoading;
        if (delBtn) delBtn.disabled = isLoading;
        // Disable preset buttons to prevent double taps while saving.
        modalEl?.querySelectorAll?.("button").forEach?.((b) => {
          if (b?.id && b.id.startsWith("preset")) b.disabled = isLoading;
        });
      };

      setScheduleLoading(true);
      // Ensure the loader is visible before the (sync) localStorage save.
      await new Promise((r) => setTimeout(r, 700));

      refreshPlanPreview();
      if (!savePlanToStorage()) return;
      renderPlanList();

      if (modalEl && typeof bootstrap !== "undefined") {
        setScheduleLoading(false);
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      }
    } catch (e) {
      const overlayEl = $("scheduleModalLoadingOverlay");
      if (overlayEl) overlayEl.classList.add("d-none");
      const saveBtn = $("btnSavePlan");
      const delBtn = $("btnClearPlan");
      if (saveBtn) saveBtn.disabled = false;
      if (delBtn) delBtn.disabled = false;
      alert(`Save plan failed: ${e?.message || e}`);
    }
  });
  $("btnClearPlan")?.addEventListener("click", () => {
    try {
      const overlayEl = $("scheduleModalLoadingOverlay");
      const editorEl = $("scheduleEditorModal");

      const active = ojtGetSchedule();
      const activeId = active?.id || ojtGetActiveScheduleId?.() || null;
      const idToDelete = ojtSelectedPlanId || activeId;

      if (!idToDelete) {
        // Nothing selected/active to delete. If plans exist, ask the user to pick one.
        const schedules = ojtGetSchedules?.() || [];
        if (schedules.length) {
          alert("Click a saved plan row first, then delete it.");
          return;
        }

        // No saved plans exist; keep UX consistent by clearing the editor/form.
        ojtClearScheduleStorage();
        if (typeof ojtPersistScheduleToServer === "function") ojtPersistScheduleToServer();
        loadPlanFromStorage();
        renderPlanList();
        return;
      }

      // Use modal confirmation instead of browser confirm().
      // (Need to be async, so we do it via an IIFE.)
      (async () => {
        const ok = await ojtAskScheduleDelete("Delete this saved schedule?");
        if (!ok) return;

        // Show loading animation during delete (localStorage update).
        if (overlayEl) overlayEl.classList.remove("d-none");
        const saveBtn = $("btnSavePlan");
        const delBtn = $("btnClearPlan");
        if (saveBtn) saveBtn.disabled = true;
        if (delBtn) delBtn.disabled = true;

        // Disable preset buttons to prevent double taps while deleting.
        editorEl?.querySelectorAll?.("button")?.forEach?.((b) => {
          if (b?.id && b.id.startsWith("preset")) b.disabled = true;
        });

        // Give the loader a moment to be noticeable.
        await new Promise((r) => setTimeout(r, 450));

        const removed = ojtDeleteScheduleById?.(idToDelete);
        if (!removed) {
          if (overlayEl) overlayEl.classList.add("d-none");
          alert("Could not delete the selected schedule (it may already be missing).");
          if (saveBtn) saveBtn.disabled = false;
          if (delBtn) delBtn.disabled = false;
        }
        ojtSelectedPlanId = null;

        if ($("assignedOffice")) $("assignedOffice").value = "";
        if ($("traineeName")) $("traineeName").value = "";
        const s = $("startDate");
        if (s) s.value = "";
        const th = $("totalHours");
        if (th) th.value = "";
        const hpd = $("hoursPerDay");
        if (hpd) hpd.value = "";
        const n = $("planNote");
        if (n) n.value = "";
        setWorkingDaysFromDows([]);
        loadPlanFromStorage();
        ojtSelectedPlanId = ojtGetSchedule()?.id || ojtGetActiveScheduleId?.() || null;
        refreshPlanPreview();
        renderPlanList();

        // Hide loader before/while closing.
        if (overlayEl) overlayEl.classList.add("d-none");

        // Close the editor modal after delete (UX: delete => modal closes).
        if (editorEl && typeof bootstrap !== "undefined") {
          bootstrap.Modal.getOrCreateInstance(editorEl).hide();
        }
      })();
    } catch (e) {
      alert(`Delete failed: ${e?.message || e}`);
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  startLiveClock();
  if (typeof ojtSyncScheduleFromServer === "function") await ojtSyncScheduleFromServer();
  wireDayPresets();
  wirePlanInputs();
  wireSaveButtons();
  loadPlanFromStorage();
  refreshPlanPreview();
  renderPlanList();
  ojtSelectedPlanId = ojtGetSchedule()?.id || ojtGetActiveScheduleId?.() || null;

  // "Add new schedule" should clear the form and switch the editor mode.
  $("btnOpenScheduleModal")?.addEventListener("click", () => {
    ojtScheduleEditorMode = "add";
    resetPlanFormForAdd();
  });
});
