/** Time in / time out — time-in-out.html (open sessions + complete later) */

function ojtAskConfirm({ title, message, confirmText = "Confirm", confirmClass = "btn-primary" }) {
  const modalEl = $("confirmActionModal");
  const titleEl = $("confirmActionTitle");
  const bodyEl = $("confirmActionBody");
  const okBtn = $("btnConfirmAction");
  if (!modalEl || !titleEl || !bodyEl || !okBtn || typeof bootstrap === "undefined") {
    return Promise.resolve(confirm(`${title}\n\n${message}`));
  }

  titleEl.textContent = title;
  bodyEl.innerHTML = ojtEscapeHtml(message).replace(/\n/g, "<br>");
  okBtn.textContent = confirmText;
  okBtn.classList.remove("btn-primary", "btn-success", "btn-danger", "btn-warning");
  okBtn.classList.add(confirmClass);

  const instance = bootstrap.Modal.getOrCreateInstance(modalEl);
  return new Promise((resolve) => {
    let decided = false;
    const onConfirm = () => {
      decided = true;
      instance.hide();
    };
    okBtn.addEventListener("click", onConfirm, { once: true });
    modalEl.addEventListener(
      "hidden.bs.modal",
      () => {
        resolve(decided);
      },
      { once: true }
    );
    instance.show();
  });
}

function ojtShowInfo(message) {
  const modalEl = $("infoActionModal");
  const bodyEl = $("infoActionBody");
  if (!modalEl || !bodyEl || typeof bootstrap === "undefined") {
    alert(message);
    return;
  }

  bodyEl.textContent = message;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function ojtUpdateTimeOutButtons() {
  ojtUpdateQuickActionButton();
}

function ojtClearEntryForm() {
  ["entryId", "entryDate", "entryTimeIn"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
  const ed = $("entryDate");
  if (ed) ed.value = ojtTodayDateString();
  ojtUpdateTimeOutButtons();
}

function ojtGetSelectedEntry() {
  const id = $("entryId")?.value?.trim();
  if (!id) return null;
  return ojtLoadEntries().find((e) => e.id === id) || null;
}

function ojtUpdateQuickActionButton() {
  const btn = $("btnClockInNow");
  if (!btn) return;
  const row = ojtGetSelectedEntry();
  const canTimeOut = Boolean(row && ojtEntryIsOpen(row));
  if (canTimeOut) {
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-outline-primary");
    btn.innerHTML = '<i class="bi bi-box-arrow-right me-1"></i>Time out now';
    btn.title = "Complete this open session now";
  } else {
    btn.classList.add("btn-primary");
    btn.classList.remove("btn-outline-primary");
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i>Time in now';
    btn.title = "Start a new session now";
  }
}

async function ojtRunClockOutNow() {
  const row = ojtGetSelectedEntry();
  const entryId = row?.id;
  const timeOut = ojtNowTimeString();
  if (!entryId) {
    ojtShowInfo("Load an open session from the table (pencil), or use Time in first.");
    return;
  }
  if (!row.timeIn) {
    ojtShowInfo("No valid open session selected.");
    return;
  }
  if (row.timeOut) {
    ojtShowInfo("This session already has a time out. Start a new session or edit another row.");
    return;
  }
  const ok = await ojtAskConfirm({
    title: "Save Time out now?",
    message: `Date: ${row.date}\nTime in: ${row.timeIn}\nTime out: ${timeOut}`,
    confirmText: "Save",
    confirmClass: "btn-success",
  });
  if (!ok) {
    return;
  }
  if ($("entryTimeOut")) $("entryTimeOut").value = timeOut;
  const res = ojtCompleteEntry(entryId, timeOut);
  if (!res.ok) {
    ojtShowInfo(res.message || "Could not clock out.");
    return;
  }
  ojtClearEntryForm();
  ojtRenderEntryTable();
  ojtUpdateTimeOutButtons();
}

function ojtRenderEntryTable() {
  const tbody = $("entryTableBody");
  if (!tbody) return;

  const all = ojtLoadEntries();
  all.sort((a, b) => {
    const c = ojtCompareDateStr(b.date, a.date);
    if (c !== 0) return c;
    return String(b.timeIn || "").localeCompare(String(a.timeIn || ""));
  });

  if (all.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-secondary py-4">
          No entries yet. Use <strong>Time in now</strong> or <strong>Save time in</strong> (step 1) to start.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = all
    .map((row) => {
      const open = ojtEntryIsOpen(row);
      const h = row.hours ?? ojtComputeHoursBetween(row.timeIn, row.timeOut);
      const esc = ojtEscapeHtml;
      const label12 = typeof ojtFormatTime12hLabel === "function" ? ojtFormatTime12hLabel : (t) => t || "—";
      const toutDisplay = row.timeOut ? esc(label12(row.timeOut)) : `<span class="text-warning">—</span>`;
      const statusBadge = open
        ? `<span class="badge text-bg-warning text-dark">Open</span>`
        : `<span class="badge text-bg-success">Done</span>`;
      return `
      <tr>
        <td>${esc(row.date)}</td>
        <td>${esc(label12(row.timeIn))}</td>
        <td>${toutDisplay}</td>
        <td>${statusBadge}</td>
        <td class="text-end fw-semibold">${open ? "—" : ojtFormatHours(h)}</td>
        <td class="text-end text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-primary ojt-edit-entry me-1" data-entry-id="${esc(row.id)}" title="Load into form">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger ojt-delete-entry" data-entry-id="${esc(row.id)}" title="Remove">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    })
    .join("");
  ojtUpdateTimeOutButtons();
}

function ojtWireTimeInOutPage() {
  $("btnClockInNow")?.addEventListener("click", async () => {
    const active = ojtGetSelectedEntry();
    if (active && ojtEntryIsOpen(active)) {
      await ojtRunClockOutNow();
      return;
    }
    const date = ojtTodayDateString();
    const timeIn = ojtNowTimeString();
    const ok = await ojtAskConfirm({
      title: "Save Time in now?",
      message: `Date: ${date}\nTime in: ${timeIn}`,
      confirmText: "Save",
      confirmClass: "btn-success",
    });
    if (!ok) {
      return;
    }
    const res = ojtAddOpenEntry(date, timeIn);
    if (!res.ok) {
      ojtShowInfo(res.message || "Could not save time in.");
      return;
    }
    if ($("entryDate")) $("entryDate").value = date;
    if ($("entryTimeIn")) $("entryTimeIn").value = timeIn;
    if ($("entryId")) $("entryId").value = res.entry.id;
    ojtRenderEntryTable();
    ojtUpdateTimeOutButtons();
  });

  $("btnSaveTimeInOnly")?.addEventListener("click", () => {
    const date = $("entryDate")?.value;
    const timeIn = $("entryTimeIn")?.value;
    const entryId = $("entryId")?.value;

    if (!date) {
      ojtShowInfo("Choose a date.");
      return;
    }
    if (!timeIn) {
      ojtShowInfo("Enter time in.");
      return;
    }

    if (entryId) {
      const res = ojtPatchEntry(entryId, { date, timeIn });
      if (!res.ok) {
        ojtShowInfo(res.message || "Could not update.");
        return;
      }
    } else {
      const res = ojtAddOpenEntry(date, timeIn);
      if (!res.ok) {
        ojtShowInfo(res.message || "Could not save.");
        return;
      }
      if ($("entryId")) $("entryId").value = res.entry.id;
    }
    ojtRenderEntryTable();
    ojtUpdateTimeOutButtons();
  });

  ["entryDate", "entryTimeIn"].forEach((fid) => {
    $(fid)?.addEventListener("input", () => ojtUpdateTimeOutButtons());
  });

  $("entryTableBody")?.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".ojt-edit-entry");
    if (editBtn) {
      const id = editBtn.getAttribute("data-entry-id");
      const row = ojtLoadEntries().find((r) => r.id === id);
      if (!row) return;
      if ($("entryId")) $("entryId").value = row.id;
      if ($("entryDate")) $("entryDate").value = row.date || "";
      if ($("entryTimeIn")) $("entryTimeIn").value = row.timeIn || "";
      $("entryDate")?.scrollIntoView({ behavior: "smooth", block: "center" });
      ojtUpdateTimeOutButtons();
      return;
    }

    const del = e.target.closest(".ojt-delete-entry");
    if (!del) return;
    const id = del.getAttribute("data-entry-id");
    if (!id) return;
    const ok = await ojtAskConfirm({
      title: "Remove this entry?",
      message: "This action cannot be undone.",
      confirmText: "Remove",
      confirmClass: "btn-danger",
    });
    if (!ok) return;
    ojtDeleteEntryById(id);
    ojtClearEntryForm();
    ojtRenderEntryTable();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  startLiveClock();
  if (typeof ojtSyncScheduleFromServer === "function") await ojtSyncScheduleFromServer();
  const hasSchedule = ojtHasSchedule();

  // Always sync entries so previously saved "time in/out" can be shown even
  // when a schedule wasn't set (common for new signups / fresh browsers).
  await ojtSyncEntriesFromServer();

  const entries = ojtLoadEntries();
  const hasAnyEntries = Array.isArray(entries) && entries.length > 0;

  // Show the page UI when either:
  // - schedule is complete, or
  // - there are existing time entries to view/edit.
  if (hasSchedule || hasAnyEntries) {
    document.documentElement.classList.add("ojt-schedule-ready");
  } else {
    document.documentElement.classList.remove("ojt-schedule-ready");
  }

  ojtWireTimeInOutPage();
  ojtClearEntryForm();
  ojtRenderEntryTable();
});
