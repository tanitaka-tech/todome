import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { ja_common } from "./locales/ja/common";
import { en_common } from "./locales/en/common";
import { ja_nav } from "./locales/ja/nav";
import { en_nav } from "./locales/en/nav";
import { ja_settings } from "./locales/ja/settings";
import { en_settings } from "./locales/en/settings";
import { ja_kanban } from "./locales/ja/kanban";
import { en_kanban } from "./locales/en/kanban";
import { ja_chat } from "./locales/ja/chat";
import { en_chat } from "./locales/en/chat";
import { ja_overview } from "./locales/ja/overview";
import { en_overview } from "./locales/en/overview";
import { ja_goal } from "./locales/ja/goal";
import { en_goal } from "./locales/en/goal";
import { ja_stats } from "./locales/ja/stats";
import { en_stats } from "./locales/en/stats";
import { ja_profile } from "./locales/ja/profile";
import { en_profile } from "./locales/en/profile";
import { ja_retro } from "./locales/ja/retro";
import { en_retro } from "./locales/en/retro";
import { ja_github } from "./locales/ja/github";
import { en_github } from "./locales/en/github";
import { ja_taskDetail } from "./locales/ja/taskDetail";
import { en_taskDetail } from "./locales/en/taskDetail";
import { ja_shortcuts } from "./locales/ja/shortcuts";
import { en_shortcuts } from "./locales/en/shortcuts";

const STORAGE_KEY = "todome.language";

function initialLang(): "ja" | "en" {
  if (typeof window === "undefined") return "ja";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "ja" || stored === "en") return stored;
  const nav = window.navigator?.language?.toLowerCase() ?? "";
  if (nav.startsWith("en")) return "en";
  return "ja";
}

void i18n.use(initReactI18next).init({
  resources: {
    ja: {
      common: ja_common,
      nav: ja_nav,
      settings: ja_settings,
      kanban: ja_kanban,
      chat: ja_chat,
      overview: ja_overview,
      goal: ja_goal,
      stats: ja_stats,
      profile: ja_profile,
      retro: ja_retro,
      github: ja_github,
      taskDetail: ja_taskDetail,
      shortcuts: ja_shortcuts,
    },
    en: {
      common: en_common,
      nav: en_nav,
      settings: en_settings,
      kanban: en_kanban,
      chat: en_chat,
      overview: en_overview,
      goal: en_goal,
      stats: en_stats,
      profile: en_profile,
      retro: en_retro,
      github: en_github,
      taskDetail: en_taskDetail,
      shortcuts: en_shortcuts,
    },
  },
  lng: initialLang(),
  fallbackLng: "ja",
  defaultNS: "common",
  ns: [
    "common",
    "nav",
    "settings",
    "kanban",
    "chat",
    "overview",
    "goal",
    "stats",
    "profile",
    "retro",
    "github",
    "taskDetail",
    "shortcuts",
  ],
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
}

export default i18n;
