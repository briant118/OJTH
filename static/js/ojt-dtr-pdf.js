/** Export Daily Time Record (DTR) as PDF — requires jsPDF + jspdf-autotable (loaded before this file) */

function ojtExportDtrPdf() {
  const schedule = ojtGetSchedule();
  if (!schedule) {
    alert("Set your schedule first (including your assigned office), then export your DTR.");
    return;
  }

  if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
    alert("PDF library failed to load. Check your internet connection and try again.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  if (typeof doc.autoTable !== "function") {
    alert("PDF table plugin failed to load. Refresh the page and try again.");
    return;
  }

  const office = schedule.assignedOffice || "—";
  const trainee = schedule.traineeName || "—";
  const generated = new Date().toLocaleString();

  let y = 14;
  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("Daily Time Record (DTR)", 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text(`Assigned office: ${office}`, 14, y);
  y += 5;
  doc.text(`Name: ${trainee}`, 14, y);
  y += 5;
  doc.text(`Plan period: ${schedule.startDate || "—"} to ${schedule.endDate || "—"}`, 14, y);
  y += 5;
  doc.text(`Generated: ${generated}`, 14, y);
  y += 8;

  const entries = ojtLoadEntries().sort((a, b) => {
    const c = ojtCompareDateStr(a.date, b.date);
    if (c !== 0) return c;
    return String(a.timeIn || "").localeCompare(String(b.timeIn || ""));
  });

  const fmtT = typeof ojtFormatTime12hLabel === "function" ? ojtFormatTime12hLabel : (t) => t || "—";

  const body = entries.map((e) => {
    const open = ojtEntryIsOpen(e);
    const h = e.hours ?? ojtComputeHoursBetween(e.timeIn, e.timeOut);
    return [
      e.date || "—",
      e.timeIn ? fmtT(e.timeIn) : "—",
      e.timeOut ? fmtT(e.timeOut) : "—",
      open ? "—" : ojtFormatHours(h),
      open ? "Open" : "Done",
    ];
  });

  if (body.length === 0) {
    body.push(["—", "—", "—", "—", "No entries yet"]);
  }

  const totalDone = entries
    .filter((e) => e.timeOut)
    .reduce((s, e) => {
      const h = e.hours ?? ojtComputeHoursBetween(e.timeIn, e.timeOut);
      return s + (h != null && !Number.isNaN(h) ? h : 0);
    }, 0);

  doc.autoTable({
    startY: y,
    head: [["Date", "Time in", "Time out", "Hours", "Status"]],
    body,
    theme: "striped",
    headStyles: { fillColor: [255, 122, 24] },
    styles: { fontSize: 9, cellPadding: 2, valign: "middle" },
    columnStyles: { 3: { halign: "right" } },
    // Force "Hours" alignment for header + body cells.
    didParseCell: (data) => {
      if (data.column?.index === 3) {
        data.cell.styles.halign = "right";
      }
    },
  });

  const tableBottom = doc.lastAutoTable && typeof doc.lastAutoTable.finalY === "number" ? doc.lastAutoTable.finalY : y + 50;
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text(`Total hours (completed sessions): ${totalDone.toFixed(2)}`, 14, tableBottom + 10);

  const safe = String(office).replace(/[^\w\-]+/g, "_").slice(0, 40) || "DTR";
  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`DTR_${safe}_${stamp}.pdf`);
}

document.addEventListener("DOMContentLoaded", () => {
  $("btnExportDtrPdf")?.addEventListener("click", () => ojtExportDtrPdf());
});
