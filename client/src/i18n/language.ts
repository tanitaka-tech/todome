import i18n from "./index";

export type Language = "ja" | "en";

export const LANGUAGES: Language[] = ["ja", "en"];

const STORAGE_KEY = "todome.language";

export function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "ja";
  const stored = window.localStorage.getItem(STORAGE_KEY) as Language | null;
  if (stored && LANGUAGES.includes(stored)) return stored;
  const nav = window.navigator?.language?.toLowerCase() ?? "";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("en")) return "en";
  return "ja";
}

export function applyLanguage(lang: Language) {
  void i18n.changeLanguage(lang);
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore quota errors
  }
}
