export type ThemeName =
  | "dark"
  | "midnight"
  | "forest"
  | "sunset"
  | "ocean"
  | "slate"
  | "beige"
  | "paper"
  | "mint"
  | "rose"
  | "sky"
  | "sand";

export const DARK_THEMES: ThemeName[] = [
  "dark",
  "midnight",
  "forest",
  "sunset",
  "ocean",
  "slate",
];

export const LIGHT_THEMES: ThemeName[] = [
  "beige",
  "paper",
  "mint",
  "rose",
  "sky",
  "sand",
];

const ALL_THEMES: ThemeName[] = [...DARK_THEMES, ...LIGHT_THEMES];

const STORAGE_KEY = "todome.theme";

export function getInitialTheme(): ThemeName {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeName | null;
  if (stored && ALL_THEMES.includes(stored)) return stored;
  return "dark";
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore quota errors
  }
}

export function isDarkTheme(theme: ThemeName): boolean {
  return DARK_THEMES.includes(theme);
}
