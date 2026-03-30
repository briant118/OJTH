/** Home dashboard — summary + chart (reads ojt-schedule + ojt-log) */

let ojtHomeChart = null;
let ojtHomeTimeModal = null;

function ojtSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ojtFormatDateStr(dateStr) {
  if (!dateStr) return "—";
  try {
    // dateStr is expected to be YYYY-MM-DD
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function ojtTotalRecordedHours() {
  return ojtLoadEntries().reduce((sum, e) => {
    if (!e.timeOut) return sum;
    const h = e.hours ?? ojtComputeHoursBetween(e.timeIn, e.timeOut);
    return sum + (h != null && !Number.isNaN(h) ? h : 0);
  }, 0);
}

function ojtHoursAggregatedByDate() {
  const map = {};
  ojtLoadEntries().forEach((e) => {
    if (!e.timeOut) return;
    const h = e.hours ?? ojtComputeHoursBetween(e.timeIn, e.timeOut);
    if (h == null || Number.isNaN(h)) return;
    map[e.date] = (map[e.date] || 0) + h;
  });
  return map;
}

function ojtHomeLatestOpenEntry() {
  const opens = ojtLoadEntries().filter((e) => ojtEntryIsOpen(e));
  opens.sort((a, b) => {
    const c = ojtCompareDateStr(b.date, a.date);
    if (c !== 0) return c;
    return String(b.timeIn || "").localeCompare(String(a.timeIn || ""));
  });
  return opens[0] || null;
}

function ojtHomeSyncQuickActionButton() {
  const btn = $("btnHomeQuickTimeAction");
  if (!btn) return;
  const open = ojtHomeLatestOpenEntry();
  if (open) {
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-outline-primary");
    btn.innerHTML = '<i class="bi bi-box-arrow-right me-1"></i>Time out';
    btn.title = "Continue your open session";
  } else {
    btn.classList.add("btn-primary");
    btn.classList.remove("btn-outline-primary");
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Time in';
    btn.title = "Start a new session";
  }
}

function ojtHomeSyncTimeOutBlock() {
  const id = $("homeEntryId")?.value?.trim() || "";
  const row = id ? ojtLoadEntries().find((e) => e.id === id) : null;
  const isOpen = Boolean(row && ojtEntryIsOpen(row));

  // If the entry is already "Time in" (open session), hide the time-in actions.
  $("homeTimeOutBlock")?.classList.toggle("d-none", !isOpen);
  $("btnHomeTimeInNow")?.classList.toggle("d-none", isOpen);
  $("btnHomeSaveTimeIn")?.classList.toggle("d-none", isOpen);
}

function ojtHomeResetTimeModalForm() {
  if ($("homeEntryId")) $("homeEntryId").value = "";
  if ($("homeEntryDate")) $("homeEntryDate").value = ojtTodayDateString();
  if ($("homeEntryTimeIn")) $("homeEntryTimeIn").value = "";
  if ($("homeEntryTimeOut")) $("homeEntryTimeOut").value = "";
  ojtHomeSyncTimeOutBlock();
}

function ojtHomeLoadOpenEntryToModal(entry) {
  if (!entry) return;
  if ($("homeEntryId")) $("homeEntryId").value = entry.id || "";
  if ($("homeEntryDate")) $("homeEntryDate").value = entry.date || "";
  if ($("homeEntryTimeIn")) $("homeEntryTimeIn").value = entry.timeIn || "";
  if ($("homeEntryTimeOut")) $("homeEntryTimeOut").value = entry.timeOut || "";
  ojtHomeSyncTimeOutBlock();
}

function ojtHomeShowTimeModal() {
  const el = $("homeTimeModal");
  if (!el || typeof bootstrap === "undefined") return;
  ojtHomeTimeModal = ojtHomeTimeModal || bootstrap.Modal.getOrCreateInstance(el);
  ojtHomeTimeModal.show();
}

function ojtHomeSetLoading(isLoading) {
  const overlay = $("homeModalLoadingOverlay");
  if (!overlay) return;

  const wasHidden = overlay.classList.contains("d-none");
  overlay.classList.toggle("d-none", !isLoading);

  // Restart loader animations when it becomes visible.
  if (isLoading && wasHidden) {
    const loader = overlay.querySelector(".loader");
    if (loader) {
      const animatedEls = [
        loader,
        ...loader.querySelectorAll("span > span"),
        ...loader.querySelectorAll(".longfazers span"),
      ];

      animatedEls.forEach((el) => {
        if (el && el.style) el.style.animation = "none";
      });

      // Force reflow so the next animation reset takes effect.
      void loader.offsetHeight;

      requestAnimationFrame(() => {
        animatedEls.forEach((el) => {
          if (el && el.style) el.style.animation = "";
        });
      });
    }
  }

  // Disable action buttons while saving.
  const btnIds = ["btnHomeTimeInNow", "btnHomeSaveTimeIn", "btnHomeTimeOutNow", "btnHomeSaveTimeOut"];
  btnIds.forEach((id) => {
    const b = $(id);
    if (b) b.disabled = Boolean(isLoading);
  });
}

async function ojtHomeShowAlert(message) {
  const modalEl = $("homeAlertModal");
  const bodyEl = $("homeAlertBody");
  if (!modalEl || !bodyEl || typeof bootstrap === "undefined") {
    alert(message);
    return;
  }

  bodyEl.textContent = message;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  // Wait until the modal is closed.
  await new Promise((resolve) => {
    const onHidden = () => {
      modalEl.removeEventListener("hidden.bs.modal", onHidden);
      resolve();
    };
    modalEl.addEventListener("hidden.bs.modal", onHidden);
  });
}

function ojtHomeWireTimeModal() {
  $("btnHomeQuickTimeAction")?.addEventListener("click", () => {
    const open = ojtHomeLatestOpenEntry();
    if (open) {
      ojtHomeLoadOpenEntryToModal(open);
      ojtHomeShowTimeModal();
      return;
    }
    ojtHomeResetTimeModalForm();
    ojtHomeShowTimeModal();
  });

  $("btnHomeTimeInNow")?.addEventListener("click", async () => {
    const date = ojtTodayDateString();
    const timeIn = ojtNowTimeString();
    ojtHomeSetLoading(true);
    const res = ojtAddOpenEntry(date, timeIn);
    if (!res.ok) {
      await ojtHomeShowAlert(res.message || "Could not save time in.");
      ojtHomeSetLoading(false);
      return;
    }
    ojtHomeLoadOpenEntryToModal(res.entry);
    ojtHomeInit();
    ojtHomeSyncQuickActionButton();
    await ojtSleep(700);
    ojtHomeSetLoading(false);
    ojtHomeTimeModal?.hide();
  });

  $("btnHomeSaveTimeIn")?.addEventListener("click", async () => {
    const date = $("homeEntryDate")?.value || "";
    const timeIn = $("homeEntryTimeIn")?.value || "";
    if (!date) {
      await ojtHomeShowAlert("Choose a date.");
      return;
    }
    if (!timeIn) {
      await ojtHomeShowAlert("Enter time in.");
      return;
    }

    ojtHomeSetLoading(true);
    const id = $("homeEntryId")?.value?.trim() || "";
    if (id) {
      const res = ojtPatchEntry(id, { date, timeIn });
      if (!res.ok) {
        await ojtHomeShowAlert(res.message || "Could not update time in.");
        ojtHomeSetLoading(false);
        return;
      }
      ojtHomeLoadOpenEntryToModal(res.entry);
    } else {
      const res = ojtAddOpenEntry(date, timeIn);
      if (!res.ok) {
        await ojtHomeShowAlert(res.message || "Could not save time in.");
        ojtHomeSetLoading(false);
        return;
      }
      ojtHomeLoadOpenEntryToModal(res.entry);
    }
    ojtHomeInit();
    ojtHomeSyncQuickActionButton();
    await ojtSleep(700);
    ojtHomeSetLoading(false);
    ojtHomeTimeModal?.hide();
  });

  $("btnHomeTimeOutNow")?.addEventListener("click", async () => {
    const id = $("homeEntryId")?.value?.trim() || "";
    if (!id) {
      await ojtHomeShowAlert("Save Time in first.");
      return;
    }
    const timeOut = ojtNowTimeString();
    ojtHomeSetLoading(true);
    const res = ojtCompleteEntry(id, timeOut);
    if (!res.ok) {
      await ojtHomeShowAlert(res.message || "Could not save time out.");
      ojtHomeSetLoading(false);
      return;
    }
    ojtHomeResetTimeModalForm();
    ojtHomeInit();
    ojtHomeSyncQuickActionButton();
    await ojtSleep(700);
    ojtHomeSetLoading(false);
    ojtHomeTimeModal?.hide();
  });

  $("btnHomeSaveTimeOut")?.addEventListener("click", async () => {
    const id = $("homeEntryId")?.value?.trim() || "";
    const timeOut = $("homeEntryTimeOut")?.value || "";
    if (!id) {
      await ojtHomeShowAlert("Save Time in first.");
      return;
    }
    if (!timeOut) {
      await ojtHomeShowAlert("Enter time out.");
      return;
    }
    ojtHomeSetLoading(true);
    const res = ojtCompleteEntry(id, timeOut);
    if (!res.ok) {
      await ojtHomeShowAlert(res.message || "Could not save time out.");
      ojtHomeSetLoading(false);
      return;
    }
    ojtHomeResetTimeModalForm();
    ojtHomeInit();
    ojtHomeSyncQuickActionButton();
    await ojtSleep(700);
    ojtHomeSetLoading(false);
    ojtHomeTimeModal?.hide();
  });
}

function ojtHomeInit() {
  const schedule = ojtGetSchedule();
  const noEl = $("homeNoSchedule");
  const dashEl = $("homeDashboard");
  if (schedule && dashEl && noEl) {
    document.documentElement.classList.add("ojt-home-has-schedule");
    noEl.classList.add("d-none");
    dashEl.classList.remove("d-none");

    const target = Number(schedule.totalHours) || 0;
    const recorded = ojtTotalRecordedHours();
    const remaining = Math.max(0, target - recorded);
    const pct = target > 0 ? Math.min(100, (recorded / target) * 100) : 0;

    const elTarget = $("homeTargetHours");
    const elRecorded = $("homeRecordedHours");
    const elRemain = $("homeRemainingHours");
    const elEnd = $("homePlanEnd");
    const elBar = $("homeProgressBar");
    const elLabel = $("homeProgressLabel");
    const elOffice = $("homeAssignedOffice");
    const elName = $("homeTraineeName");
    if (elOffice) elOffice.textContent = schedule.assignedOffice || "—";
    if (elName) elName.textContent = schedule.traineeName || "—";

    const elOngoing = $("homeOngoingPlanLine");
    if (elOngoing) {
      const start = ojtFormatDateStr(schedule.startDate);
      const end = ojtFormatDateStr(schedule.endDate);
      elOngoing.textContent = `${start} → ${end}`;
    }

    if (elTarget) elTarget.textContent = ojtFormatHours(target);
    if (elRecorded) elRecorded.textContent = ojtFormatHours(recorded);
    if (elRemain) elRemain.textContent = ojtFormatHours(remaining);
    if (elEnd) elEnd.textContent = schedule.endDate || "—";
    if (elBar) {
      elBar.style.width = `${pct}%`;
      elBar.setAttribute("aria-valuenow", String(Math.round(pct)));
    }
    if (elLabel) elLabel.textContent = `${pct.toFixed(0)}%`;

    ojtHomeRenderChart();
    ojtHomeSyncQuickActionButton();
  } else {
    document.documentElement.classList.remove("ojt-home-has-schedule");
    if (noEl) noEl.classList.remove("d-none");
    if (dashEl) dashEl.classList.add("d-none");
  }
}

function ojtHomeRenderChart() {
  const canvas = $("homeHoursChart");
  if (!canvas || typeof Chart === "undefined") return;

  const today = ojtTodayDateString();
  const entries = ojtLoadEntries().filter((e) => e && e.date === today);
  const logins = entries.filter((e) => e.timeIn).length;
  const logouts = entries.filter((e) => e.timeOut).length;

  // Single-day view; naturally resets when the date changes.
  const labels = ["Today"];
  const valuesIn = [logins];
  const valuesOut = [logouts];

  if (ojtHomeChart) {
    ojtHomeChart.destroy();
    ojtHomeChart = null;
  }

  ojtHomeChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Time in",
          data: valuesIn,
          backgroundColor: "rgba(255, 122, 24, 0.92)",
          borderColor: "rgba(255, 122, 24, 1)",
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: "Time out",
          data: valuesOut,
          backgroundColor: "rgba(25, 197, 191, 0.75)",
          borderColor: "rgba(25, 197, 191, 1)",
          borderWidth: 2,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: false,
          text: "Recorded hours by date (up to 14 days with data)",
          color: "rgba(255, 255, 255, 0.92)",
          font: { size: 14 },
        },
      },
      layout: {
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: false, text: "Count", color: "rgba(255, 255, 255, 0.92)" },
          ticks: { color: "rgba(255, 255, 255, 0.9)" },
          grid: { color: "rgba(255, 255, 255, 0.14)" },
          border: { color: "rgba(255, 255, 255, 0.10)" },
        },
        x: {
          ticks: { color: "rgba(255, 255, 255, 0.9)" },
          grid: { color: "rgba(255, 255, 255, 0.10)" },
          ticks: { maxRotation: 0, minRotation: 0, padding: 6 },
          border: { color: "rgba(255, 255, 255, 0.10)" },
        },
      },
    },
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  ojtHomeWireTimeModal();
  if (typeof ojtSyncScheduleFromServer === "function") await ojtSyncScheduleFromServer();
  await ojtSyncEntriesFromServer();
  ojtHomeInit();
  // Use shared header time (driven by ojt-common.js) if present.
  if (typeof startLiveClock === "function") startLiveClock();
});
