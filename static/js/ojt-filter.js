/** Records page — calculate.html (show all sessions; add/edit/delete) */

let ojtRecordEditorModal = null;
let ojtRecordViewModal = null;

function ojtAskDeleteConfirm(message) {
  const modalEl = $("deleteConfirmModal");
  const bodyEl = $("deleteConfirmBody");
  const okBtn = $("btnDeleteConfirmRecord");
  const titleEl = $("deleteConfirmTitle");

  if (!modalEl || !bodyEl || !okBtn || !titleEl || typeof bootstrap === "undefined") {
    const ok = confirm(message);
    return Promise.resolve(ok);
  }

  bodyEl.textContent = message;

  const instance = bootstrap.Modal.getOrCreateInstance(modalEl);
  return new Promise((resolve) => {
    let decided = false;

    const onOk = () => {
      decided = true;
      instance.hide();
    };

    okBtn.addEventListener("click", onOk, { once: true });
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

function ojtShowRecordEditor() {
  const el = $("recordEditorCard");
  if (!el) return;
  el.classList.remove("d-none");
}

function ojtHideRecordEditor() {
  const el = $("recordEditorCard");
  if (!el) return;
  el.classList.add("d-none");
}

function ojtShowRecordView(row) {
  if (!row) return;
  if ($("viewDate")) $("viewDate").textContent = row.date || "—";
  if ($("viewTimeIn")) $("viewTimeIn").textContent = typeof ojtFormatTime12hLabel === "function" ? ojtFormatTime12hLabel(row.timeIn) : row.timeIn || "—";
  if ($("viewTimeOut"))
    $("viewTimeOut").textContent = row.timeOut
      ? typeof ojtFormatTime12hLabel === "function"
        ? ojtFormatTime12hLabel(row.timeOut)
        : row.timeOut
      : "—";
  if ($("viewStatus")) $("viewStatus").textContent = ojtEntryIsOpen(row) ? "Open" : "Done";
  const h = row.hours ?? ojtComputeHoursBetween(row.timeIn, row.timeOut);
  if ($("viewHours")) {
    if (ojtEntryIsOpen(row)) {
      $("viewHours").textContent = "—";
    } else {
      const v = ojtFormatHours(h);
      $("viewHours").innerHTML = `<span class="ojt-hours-val">${v}</span>`;
    }
  }

  const el = $("recordViewModal");
  if (!el || typeof bootstrap === "undefined") return;
  ojtRecordViewModal = ojtRecordViewModal || bootstrap.Modal.getOrCreateInstance(el);
  ojtRecordViewModal.show();
}

function ojtSanitizeHourMinuteInput(el) {
  if (!el) return;
  el.value = String(el.value || "").replace(/\D/g, "").slice(0, 2);
}

function ojtPadTwoDigitOnBlur(el) {
  if (!el) return;
  const raw = String(el.value || "").trim();
  if (!raw) return;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return;
  el.value = String(n).padStart(2, "0");
}

function ojtResetRecordForm() {
  if ($("recordId")) $("recordId").value = "";
  if ($("recordDate")) $("recordDate").value = ojtTodayDateString();
  if ($("recordTimeInH")) $("recordTimeInH").value = "";
  if ($("recordTimeInM")) $("recordTimeInM").value = "";
  if ($("recordTimeOutH")) $("recordTimeOutH").value = "00";
  if ($("recordTimeOutM")) $("recordTimeOutM").value = "00";
  if ($("recordTimeInAmPm")) $("recordTimeInAmPm").value = "AM";
  if ($("recordTimeOutAmPm")) $("recordTimeOutAmPm").value = "PM";
  if ($("recordFormMode")) $("recordFormMode").textContent = "Adding new record";
}

function ojtLoadRecordIntoForm(row) {
  if (!row) return;
  if ($("recordId")) $("recordId").value = row.id || "";
  if ($("recordDate")) $("recordDate").value = row.date || "";
  const tin = ojtTime24hTo12hParts(row.timeIn);
  if ($("recordTimeInH")) $("recordTimeInH").value = tin.h;
  if ($("recordTimeInM")) $("recordTimeInM").value = tin.mm;
  if ($("recordTimeInAmPm")) $("recordTimeInAmPm").value = tin.ap;
  const tout = ojtTime24hTo12hParts(row.timeOut);
  if ($("recordTimeOutH")) $("recordTimeOutH").value = row.timeOut ? tout.h : "";
  if ($("recordTimeOutM")) $("recordTimeOutM").value = row.timeOut ? tout.mm : "";
  if ($("recordTimeOutAmPm")) $("recordTimeOutAmPm").value = row.timeOut ? tout.ap : "PM";
  if ($("recordFormMode")) $("recordFormMode").textContent = "Editing selected record";
}

function ojtSyncHeaderActionStates() {
  const selectedId = $("recordId")?.value?.trim() || "";
  const editBtn = $("btnEditRecordTop");
  const delBtn = $("btnDeleteRecordTop");
  if (editBtn) editBtn.disabled = !selectedId;
  if (delBtn) delBtn.disabled = !selectedId;
}

function ojtRenderRecordsTable() {
  const tbody = $("resultsTableBody");
  const meta = $("recordsMeta");
  const totalEl = $("recordsTotalHours");
  if (!tbody) return;

  const all = ojtLoadEntries();
  all.sort((a, b) => {
    const c = ojtCompareDateStr(b.date, a.date);
    if (c !== 0) return c;
    return String(b.timeIn || "").localeCompare(String(a.timeIn || ""));
  });

  let totalH = 0;
  all.forEach((row) => {
    if (!row.timeOut) return;
    const h = row.hours ?? ojtComputeHoursBetween(row.timeIn, row.timeOut);
    if (h != null && !Number.isNaN(h)) totalH += h;
  });

  const label12 = typeof ojtFormatTime12hLabel === "function" ? ojtFormatTime12hLabel : (t) => t || "—";

  if (meta) {
    meta.textContent = `${all.length} ${all.length === 1 ? "record" : "records"}`;
  }
  if (totalEl) {
    totalEl.innerHTML = `<span class="ojt-hours-val">${ojtFormatHours(totalH)}</span>`;
  }

  if (all.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-secondary py-4">No records yet. Add your first session above.</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = all
    .map((row) => {
      const open = ojtEntryIsOpen(row);
      const h = row.hours ?? ojtComputeHoursBetween(row.timeIn, row.timeOut);
      const esc = ojtEscapeHtml;
      const tinLabel = esc(label12(row.timeIn));
      const toutDisplay = row.timeOut
        ? esc(label12(row.timeOut))
        : '<span class="text-warning">—</span>';
      const statusBadge = open
        ? '<span class="badge text-bg-warning text-dark">Open</span>'
        : '<span class="badge text-bg-success">Done</span>';
      return `
      <tr class="ojt-record-row" data-entry-id="${esc(row.id)}">
        <td>${esc(row.date)}</td>
        <td>${tinLabel}</td>
        <td>${toutDisplay}</td>
        <td>${statusBadge}</td>
        <td class="text-end fw-semibold">${open ? "—" : `<span class="ojt-hours-val">${ojtFormatHours(h)}</span>`}</td>
      </tr>`;
    })
    .join("");
  ojtSyncHeaderActionStates();
}

function ojtSaveRecordFromForm() {
  const id = $("recordId")?.value?.trim() || "";
  const date = $("recordDate")?.value || "";
  const inH = $("recordTimeInH")?.value ?? "";
  const inM = $("recordTimeInM")?.value ?? "";
  const inAp = $("recordTimeInAmPm")?.value ?? "AM";
  const outH = $("recordTimeOutH")?.value ?? "";
  const outM = $("recordTimeOutM")?.value ?? "";
  const outAp = $("recordTimeOutAmPm")?.value ?? "PM";

  const timeIn = ojtTime12hPartsTo24h(inH, inM, inAp);
  const outHTrim = String(outH).trim();
  const timeOutEmpty = !outHTrim;
  const timeOut = timeOutEmpty ? "" : ojtTime12hPartsTo24h(outH, outM, outAp);

  if (!date) {
    alert("Choose a date.");
    return;
  }
  if (!timeIn) {
    alert("Invalid time in. Use hour 00–12 (00 means 12 o\u2019clock), minutes 0–59, and AM or PM.");
    return;
  }
  if (!timeOutEmpty && !timeOut) {
    alert("Invalid time out. Use hour 00–12, minutes 0–59, and AM or PM—or leave time out blank for an open session.");
    return;
  }

  const tinParts = ojtTime24hTo12hParts(timeIn);
  if ($("recordTimeInH")) $("recordTimeInH").value = tinParts.h;
  if ($("recordTimeInM")) $("recordTimeInM").value = tinParts.mm;
  if ($("recordTimeInAmPm")) $("recordTimeInAmPm").value = tinParts.ap;
  if (timeOut) {
    const tp = ojtTime24hTo12hParts(timeOut);
    if ($("recordTimeOutH")) $("recordTimeOutH").value = tp.h;
    if ($("recordTimeOutM")) $("recordTimeOutM").value = tp.mm;
    if ($("recordTimeOutAmPm")) $("recordTimeOutAmPm").value = tp.ap;
  } else {
    if ($("recordTimeOutH")) $("recordTimeOutH").value = "";
    if ($("recordTimeOutM")) $("recordTimeOutM").value = "";
    if ($("recordTimeOutAmPm")) $("recordTimeOutAmPm").value = "PM";
  }

  if (id) {
    // Existing row: always patch this same row (including time out when provided).
    const res = ojtPatchEntry(id, { date, timeIn, timeOut: timeOut || null });
    if (!res.ok) {
      alert(res.message || "Could not update record.");
      return;
    }
  } else {
    // New row: create complete session if time out exists, otherwise open session.
    if (timeOut) {
      const res = ojtSaveFullEntry({ date, timeIn, timeOut });
      if (!res.ok) {
        alert(res.message || "Could not save record.");
        return;
      }
    } else {
      const res = ojtAddOpenEntry(date, timeIn);
      if (!res.ok) {
        alert(res.message || "Could not save record.");
        return;
      }
    }
  }

  ojtResetRecordForm();
  ojtRenderRecordsTable();
  // UX: saving a record should close the editor.
  ojtHideRecordEditor();
}

function ojtWireRecordsPage() {
  const runDeleteCurrentRecord = async () => {
    const id = $("recordId")?.value?.trim() || "";
    if (!id) {
      alert("Click a record row first to delete.");
      return;
    }

    const ok = await ojtAskDeleteConfirm("Delete selected record?");
    if (!ok) return;

    ojtDeleteEntryById(id);
    ojtResetRecordForm();
    ojtRenderRecordsTable();
    ojtSyncHeaderActionStates();
  };

  $("btnSaveRecord")?.addEventListener("click", () => {
    ojtSaveRecordFromForm();
  });

  $("btnNewRecord")?.addEventListener("click", () => {
    ojtShowRecordEditor();
    ojtResetRecordForm();
  });
  $("btnAddRecordTop")?.addEventListener("click", () => {
    ojtShowRecordEditor();
    ojtResetRecordForm();
  });
  $("btnEditRecordTop")?.addEventListener("click", () => {
    const id = $("recordId")?.value?.trim() || "";
    if (!id) {
      alert("Click a record row first to edit.");
      return;
    }
    const row = ojtLoadEntries().find((r) => r.id === id);
    if (!row) return;
    ojtShowRecordEditor();
    ojtLoadRecordIntoForm(row);
  });
  $("btnDeleteRecordTop")?.addEventListener("click", () => {
    runDeleteCurrentRecord();
  });
  $("btnDeleteRecordForm")?.addEventListener("click", () => {
    runDeleteCurrentRecord();
  });
  $("btnExportRecordTop")?.addEventListener("click", () => {
    if (typeof ojtExportDtrPdf === "function") {
      ojtExportDtrPdf();
      return;
    }
    alert("PDF export is unavailable right now.");
  });
  $("btnExportRecordsJson")?.addEventListener("click", () => {
    if (typeof ojtExportEntriesJson !== "function") {
      alert("JSON export is unavailable.");
      return;
    }
    ojtExportEntriesJson();
  });
  $("btnImportRecordsTop")?.addEventListener("click", () => {
    $("ojtImportRecordsFile")?.click();
  });
  $("ojtImportRecordsFile")?.addEventListener("change", (e) => {
    const input = e.target;
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    if (typeof ojtParseImportRecordsJson !== "function" || typeof ojtMergeImportIntoEntries !== "function") {
      alert("Import is unavailable.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = ojtParseImportRecordsJson(text);
      if (!parsed.ok) {
        alert(parsed.message || "Import failed.");
        return;
      }
      const n = parsed.entries.length;
      const skipNote = parsed.skipped ? ` (${parsed.skipped} row(s) in file skipped as invalid.)` : "";
      const okGo = confirm(
        `Import ${n} record(s) from this file?${skipNote}\n\nRows with the same id as in the backup will replace your current rows. Other rows are kept.`
      );
      if (!okGo) return;
      const res = ojtMergeImportIntoEntries(parsed.entries);
      ojtRenderRecordsTable();
      ojtSyncHeaderActionStates();
      alert(
        `Import finished. You now have ${res.count} record(s) (${res.imported} applied from file).${
          parsed.skipped ? ` ${parsed.skipped} row(s) were skipped.` : ""
        }`
      );
    };
    reader.onerror = () => alert("Could not read the file.");
    reader.readAsText(file, "UTF-8");
  });
  $("btnCloseRecordEditor")?.addEventListener("click", () => {
    ojtHideRecordEditor();
  });
  $("btnViewEditRecord")?.addEventListener("click", () => {
    const id = $("recordId")?.value?.trim() || "";
    if (!id) return;
    const row = ojtLoadEntries().find((r) => r.id === id);
    if (!row) return;
    ojtRecordViewModal?.hide();
    ojtShowRecordEditor();
    ojtLoadRecordIntoForm(row);
  });
  $("btnViewDeleteRecord")?.addEventListener("click", () => {
    ojtRecordViewModal?.hide();
    runDeleteCurrentRecord();
  });

  ["recordTimeInH", "recordTimeInM", "recordTimeOutH", "recordTimeOutM"].forEach((id) => {
    $(id)?.addEventListener("input", () => ojtSanitizeHourMinuteInput($(id)));
    $(id)?.addEventListener("blur", () => ojtPadTwoDigitOnBlur($(id)));
  });

  $("resultsTableBody")?.addEventListener("click", (e) => {
    const rowEl = e.target.closest(".ojt-record-row");
    if (!rowEl) return;
    const id = rowEl.getAttribute("data-entry-id");
    if (!id) return;
    const row = ojtLoadEntries().find((r) => r.id === id);
    if (!row) return;
    ojtLoadRecordIntoForm(row);
    ojtShowRecordView(row);
    ojtSyncHeaderActionStates();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  startLiveClock();
  ojtWireRecordsPage();
  ojtResetRecordForm();
  ojtHideRecordEditor();
  if (typeof ojtSyncScheduleFromServer === "function") await ojtSyncScheduleFromServer();
  await ojtSyncEntriesFromServer();
  ojtRenderRecordsTable();
  ojtSyncHeaderActionStates();
});
