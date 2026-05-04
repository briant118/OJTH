/** Shared: live clock — load on every page that has #liveDateTime */
const $ = (id) => document.getElementById(id);

function ojtFormatTimeAmPm(timeStr) {
  const s = String(timeStr || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s || "—";
  let hh = Number(m[1]);
  const mm = String(m[2]).padStart(2, "0");
  if (Number.isNaN(hh) || hh < 0 || hh > 23) return s;

  // Convert to 12-hour display but keep minutes; force seconds to 00.
  const ampm = hh >= 12 ? "PM" : "am";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${String(hh).padStart(2, "0")}:${mm}:00 ${ampm}`;
}

function startLiveClock() {
  const el = $("liveDateTime");
  if (!el) return;

  const tick = () => {
    // If log functions exist, show "Time in" status for today/open session.
    // Otherwise fallback to a simple live clock.
    try {
      if (typeof ojtLoadEntries === "function") {
        const today = new Date().toISOString().slice(0, 10);
        const entries = ojtLoadEntries() || [];
        const todays = entries.filter((e) => e && e.date === today);
        const open = todays.filter((e) => typeof ojtEntryIsOpen === "function" && ojtEntryIsOpen(e));

        const latestByTime = (arr) => {
          return arr.sort((a, b) => {
            const da = String(a.timeIn || "");
            const db = String(b.timeIn || "");
            return da.localeCompare(db);
          });
        };

        if (open.length) {
          latestByTime(open);
          el.textContent = `IN ${ojtFormatTimeAmPm(open[open.length - 1].timeIn)}`;
          return;
        }

        const completed = todays.filter((e) => e && e.timeIn && e.timeOut);
        if (completed.length) {
          latestByTime(completed);
          const last = completed[completed.length - 1];
          // For completed sessions show the latest OUT time.
          el.textContent = `OUT ${ojtFormatTimeAmPm(last.timeOut || last.timeIn)}`;
          return;
        }

        const withTimeIn = todays.filter((e) => e && e.timeIn);
        if (withTimeIn.length) {
          latestByTime(withTimeIn);
          const last = withTimeIn[withTimeIn.length - 1];
          el.textContent = `IN ${ojtFormatTimeAmPm(last.timeIn)}`;
          return;
        }

        el.textContent = "—";
        return;
      }
    } catch {
      // ignore and fallback
    }

    const now = new Date();
    const hh24 = now.getHours();
    const ampm = hh24 >= 12 ? "PM" : "am";
    let hh = hh24 % 12;
    if (hh === 0) hh = 12;
    el.textContent = `${String(hh).padStart(2, "0")}:00:00 ${ampm}`;
  };

  tick();
  setInterval(tick, 1000);
}
