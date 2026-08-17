export interface RunStatusTimeLabel {
  dateTime: string;
  label: string;
  title: string;
}

const MATERIAL_FUTURE_SKEW_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRunStatusTime(
  value: string,
  now = Date.now(),
  locale?: string,
): RunStatusTimeLabel | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return null;

  const date = new Date(timestamp);
  const delta = now - timestamp;
  const title = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  if (delta < -MATERIAL_FUTURE_SKEW_MS) {
    return { dateTime: date.toISOString(), label: "Update time unavailable", title };
  }
  if (delta < MINUTE_MS) {
    return { dateTime: date.toISOString(), label: "Status updated just now", title };
  }
  if (delta < HOUR_MS) {
    const minutes = Math.floor(delta / MINUTE_MS);
    return {
      dateTime: date.toISOString(),
      label: `Status updated ${minutes} min ago`,
      title,
    };
  }
  if (delta < DAY_MS) {
    const hours = Math.floor(delta / HOUR_MS);
    return {
      dateTime: date.toISOString(),
      label: `Status updated ${hours} hr ago`,
      title,
    };
  }

  const includeYear = date.getFullYear() !== new Date(now).getFullYear();
  const absolute = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return {
    dateTime: date.toISOString(),
    label: `Status updated ${absolute}`,
    title,
  };
}
