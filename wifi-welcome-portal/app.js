
async function readDefaultSchedule() {
  const year = 2026;
  const cacheKey = "chicagoPrayerCalendar2026";
  const days = {};

  // 1. Try to load the cached full-year calendar.
  try {
    const cached = JSON.parse(
      localStorage.getItem(cacheKey) || "null"
    );

    if (cached?.days && Object.keys(cached.days).length >= 300) {
      Object.assign(days, cached.days);
    }
  } catch (error) {
    console.warn("Could not read cached calendar:", error);
  }

  // 2. Fetch all 12 months if the cache is incomplete.
  if (Object.keys(days).length < 300) {
    try {
      for (let month = 1; month <= 12; month++) {
        const url =
          `https://api.aladhan.com/v1/calendarByCity/${year}/${month}` +
          "?city=Chicago&country=US&state=Illinois" +
          "&method=2&school=0&timezonestring=America%2FChicago";

        // Give up on a slow/offline API after 10 s so the page never hangs.
        const response = await fetch(url, {
          signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
            ? AbortSignal.timeout(10000)
            : undefined
        });

        if (!response.ok) {
          throw new Error(
            `Could not load month ${month}: HTTP ${response.status}`
          );
        }

        const result = await response.json();

        if (result.code !== 200 || !Array.isArray(result.data)) {
          throw new Error(`Invalid calendar data for month ${month}`);
        }

        for (const entry of result.data) {
          const parts = entry.date?.gregorian?.date?.split("-");

          if (!parts || parts.length !== 3) continue;

          const [day, monthText, yearText] = parts;
          const key =
            `${yearText}-${monthText.padStart(2, "0")}-${day.padStart(2, "0")}`;

          if (!key.startsWith(`${year}-`)) continue;

          const clean = (value) => {
            const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
            return match
              ? `${match[1].padStart(2, "0")}:${match[2]}`
              : null;
          };

          const times = {
            Fajr: clean(entry.timings?.Fajr),
            Sunrise: clean(entry.timings?.Sunrise),
            Dhuhr: clean(entry.timings?.Dhuhr),
            Asr: clean(entry.timings?.Asr),
            Maghrib: clean(entry.timings?.Maghrib),
            Isha: clean(entry.timings?.Isha)
          };

          if (Object.values(times).every(Boolean)) {
            days[key] = times;
          }
        }
      }

      if (Object.keys(days).length > 300) {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ days })
        );
      }
    } catch (error) {
      console.error("Annual calendar download failed:", error);
    }
  }

  // 3. Load your existing local JSON timetable.
  let localSchedule = null;

  try {
    const response = await fetch("/data/prayer-times.json", {
      cache: "no-cache"
    });

    if (response.ok) {
      localSchedule = await response.json();
    }
  } catch (error) {
    console.warn("Could not load local timetable:", error);
  }

  // 4. Local entries take priority over calculated entries.
  const combinedDays = {
    ...days,
    ...(localSchedule?.days || {})
  };

  if (!Object.keys(combinedDays).length) {
    return null;
  }

  return {
    city: "Chicago, Illinois",
    method: "ISNA",
    asr_method: "Standard",
    verified: false,
    source: "Calculated Chicago calendar with local timetable overrides",
    days: combinedDays
  };
}

// ---------------------------------------------------------------------------
// Keep the service worker up to date (works on http://127.0.0.1 and https).
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(registration => registration.update())
      .catch(error => console.warn("Service worker not registered:", error));
  });
}

// ---------------------------------------------------------------------------
// Salah page: runs only when the Salah page elements exist.
// ---------------------------------------------------------------------------
(function initSalahPage() {
  "use strict";

  const rowsEl = document.getElementById("prayerRows");
  const picker = document.getElementById("datePicker");
  if (!rowsEl || !picker) return; // Not the Salah page.

  const titleEl = document.getElementById("dateTitle");
  const nextEl = document.getElementById("nextPrayer");
  const statusEl = document.getElementById("dataStatus");
  const todayBtn = document.getElementById("todayBtn");
  const fileInput = document.getElementById("scheduleFile");
  const clearBtn = document.getElementById("clearSaved");

  const TIME_ZONE = "America/Chicago";
  const IMPORT_KEY = "importedPrayerSchedule";
  const REQUIRED = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
  const ROWS = [
    ["Fajr", "Dawn prayer"],
    ["Sunrise", "Sun rises (not a prayer time)"],
    ["Dhuhr", "Midday prayer"],
    ["Asr", "Afternoon prayer"],
    ["Maghrib", "Sunset prayer"],
    ["Isha", "Night prayer"]
  ];

  let localDays = {};     // data/prayer-times.json
  let calendarDays = {};  // AlAdhan calendar merged with local file
  let importedDays = {};  // file imported by the user (saved in this browser)
  let calendarState = "loading"; // "loading" | "ready" | "unavailable"

  // ---- helpers -----------------------------------------------------------
  function chicagoNow() {
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
    return {
      key: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
  }

  function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value + "T00:00:00Z"));
  }

  function addDays(key, count) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
  }

  function longDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: "long", year: "numeric",
      month: "long", day: "numeric"
    });
  }

  function validTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function validDay(times) {
    if (!times || typeof times !== "object") return false;
    if (!REQUIRED.every(name => validTime(times[name]))) return false;
    return times.Sunrise === undefined || times.Sunrise === null ||
      validTime(times.Sunrise);
  }

  function pretty(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }

  function pickValid(days) {
    const out = {};
    for (const [key, times] of Object.entries(days || {})) {
      if (isDateKey(key) && validDay(times)) out[key] = times;
    }
    return out;
  }

  function lookup(key) {
    if (importedDays[key]) return { times: importedDays[key], source: "imported file" };
    if (localDays[key]) return { times: localDays[key], source: "local timetable (data/prayer-times.json)" };
    if (calendarDays[key] && validDay(calendarDays[key])) {
      return { times: calendarDays[key], source: "calculated Chicago calendar (ISNA, Standard Asr)" };
    }
    return null;
  }

  // ---- rendering ---------------------------------------------------------
  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  function cell(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function showNextPrayer(key, found) {
    if (!nextEl) return;
    nextEl.textContent = "";
    const now = chicagoNow();
    if (key !== now.key || !found) return;

    for (const name of REQUIRED) {
      const [h, m] = found.times[name].split(":").map(Number);
      if (h * 60 + m > now.minutes) {
        nextEl.textContent = `Next prayer: ${name} at ${pretty(found.times[name])} (Chicago time)`;
        return;
      }
    }
    const tomorrow = lookup(addDays(key, 1));
    nextEl.textContent = tomorrow
      ? `Next prayer: Fajr tomorrow at ${pretty(tomorrow.times.Fajr)} (Chicago time)`
      : "All of today's prayers have passed.";
  }

  function render() {
    const key = picker.value;
    rowsEl.textContent = "";
    if (nextEl) nextEl.textContent = "";

    if (!isDateKey(key)) {
      titleEl.textContent = "Prayer schedule";
      setStatus("Please choose a valid date.");
      return;
    }

    titleEl.textContent = `Prayer schedule — ${longDate(key)}`;
    const found = lookup(key);

    if (!found) {
      if (calendarState === "loading") {
        setStatus("No local timetable entry for this date. Loading the calculated calendar…");
      } else if (calendarState === "unavailable") {
        setStatus("No prayer times are stored for this date, and the online calendar could not be loaded. Choose another date, reconnect to the internet, or import a timetable.");
      } else {
        setStatus("No prayer times are available for this date. Choose another date or import a timetable.");
      }
      return;
    }

    for (const [name, detail] of ROWS) {
      const value = found.times[name];
      if (!value && name === "Sunrise") continue; // Sunrise is optional.
      const tr = document.createElement("tr");
      tr.append(cell("td", name), cell("td", pretty(value)), cell("td", detail));
      rowsEl.append(tr);
    }

    let message = `Source: ${found.source}. Not independently verified — please check with your local mosque.`;
    if (calendarState === "unavailable" && found.source !== "calculated Chicago calendar (ISNA, Standard Asr)") {
      message += " (Online calendar unavailable; showing saved data only.)";
    }
    setStatus(message);
    showNextPrayer(key, found);
  }

  // ---- data loading ------------------------------------------------------
  async function loadLocalFile() {
    try {
      const response = await fetch("/data/prayer-times.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      localDays = pickValid((await response.json()).days);
    } catch (error) {
      console.warn("Could not load local timetable:", error);
      localDays = {};
    }
  }

  function loadImported() {
    try {
      importedDays = pickValid(JSON.parse(localStorage.getItem(IMPORT_KEY) || "null")?.days);
    } catch (error) {
      importedDays = {};
    }
  }

  async function loadCalendarInBackground() {
    try {
      const schedule = await readDefaultSchedule();
      calendarDays = schedule?.days || {};
      const extra = Object.keys(calendarDays).filter(key => !localDays[key]).length;
      calendarState = extra > 0 ? "ready" : "unavailable";
    } catch (error) {
      console.warn("Calendar load failed:", error);
      calendarState = "unavailable";
    }
    render();
  }

  // ---- events ------------------------------------------------------------
  picker.addEventListener("change", render);
  picker.addEventListener("input", render);

  todayBtn?.addEventListener("click", () => {
    picker.value = chicagoNow().key;
    render();
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("File is larger than 2 MB.");
      const data = JSON.parse(await file.text());
      const valid = pickValid(data?.days);
      const count = Object.keys(valid).length;
      if (!count) throw new Error("No valid dates found. Each date needs Fajr, Dhuhr, Asr, Maghrib and Isha in HH:MM format.");
      importedDays = { ...importedDays, ...valid };
      localStorage.setItem(IMPORT_KEY, JSON.stringify({ days: importedDays }));
      render();
      setStatus(`Imported ${count} day(s). ` + statusEl.textContent);
    } catch (error) {
      setStatus(`Could not import the file: ${error.message}`);
    } finally {
      fileInput.value = "";
    }
  });

  clearBtn?.addEventListener("click", () => {
    try { localStorage.removeItem(IMPORT_KEY); } catch (error) { /* ignore */ }
    importedDays = {};
    render();
  });

  // ---- start -------------------------------------------------------------
  (async function start() {
    picker.value = chicagoNow().key;
    loadImported();
    await loadLocalFile();   // fast, local, works offline
    render();                // table appears now, without waiting for the API
    loadCalendarInBackground();
  })();
})();
