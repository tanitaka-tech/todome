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

// 各テーマの --accent 値（style.css と同期）。
// CSS から動的に読み出す方法もあるが、useEffect 内 setState を避けるために
// テーマ名ベースで同期計算できるようマップで保持する。
const THEME_ACCENT: Record<ThemeName, string> = {
  dark: "#8a5ff0",
  midnight: "#4c8bf5",
  forest: "#4ade80",
  sunset: "#f472b6",
  ocean: "#22d3ee",
  slate: "#94a3b8",
  beige: "#9a5b2f",
  paper: "#111827",
  mint: "#15803d",
  rose: "#be185d",
  sky: "#0369a1",
  sand: "#a16207",
};

export function getThemeAccent(theme: ThemeName): string {
  return THEME_ACCENT[theme] ?? "#6366f1";
}
