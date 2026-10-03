const DEFAULT_TIME_ZONE = process.env.YTB_RANKING_WINDOW_TIME_ZONE || "Asia/Taipei";
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const wallClockAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second),
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

// Epoch ms of 00:00 on the first day of the month containing `instant`, observed
// in `timeZone`. Corrected twice so month boundaries survive a zone offset.
function startOfCalendarMonth(instant, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error(`cannot resolve calendar month for ${new Date(instant).toISOString()} in ${timeZone}`);
  }

  const utcMidnight = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const first = utcMidnight - zoneOffsetMs(utcMidnight, timeZone);
  const corrected = utcMidnight - zoneOffsetMs(first, timeZone);
  return corrected === first ? first : corrected;
}

function formatDate(timestamp, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  WEEK_WINDOW_MS,
  formatDate,
  startOfCalendarMonth,
  zoneOffsetMs,
};
