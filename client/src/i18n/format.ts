import i18n from "./index";

function currentLocale(): string {
  return i18n.language === "en" ? "en-US" : "ja-JP";
}

export function formatDateTime(
  date: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString(currentLocale(), opts);
}

export function formatDate(
  date: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString(currentLocale(), opts);
}

export function formatTime(
  date: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString(currentLocale(), opts);
}
