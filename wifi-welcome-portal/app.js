
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

        const response = await fetch(url);

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
