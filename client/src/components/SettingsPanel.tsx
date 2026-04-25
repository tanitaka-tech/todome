import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ThemeName } from "../theme";
import type { Language } from "../i18n/language";
import { formatDateTime } from "../i18n/format";
import type { AIToolConfig, GitHubStatus, RepoInfo } from "../types";

interface Props {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  githubStatus: GitHubStatus | null;
  githubRepos: RepoInfo[];
  onRequestRepoList: () => void;
  onLinkRepo: (args: {
    owner?: string;
    name: string;
    create: boolean;
    private: boolean;
  }) => void;
  onUnlink: () => void;
  onSyncNow: () => void;
  onPullNow: () => void;
  onToggleAutoSync: (value: boolean) => void;
  aiConfig: AIToolConfig;
  onUpdateAIConfig: (config: AIToolConfig) => void;
  dayBoundaryHour: number;
  onDayBoundaryHourChange: (hour: number) => void;
  calendarWeekStart: 0 | 1;
  onCalendarWeekStartChange: (weekStart: 0 | 1) => void;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
}

// IANA TZ の代表的なものだけ列挙。"" は「自動 (ブラウザ/サーバーの実 TZ)」。
// 必要になったら拡張する。
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Auto" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (KST)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
  { value: "America/New_York", label: "America/New_York (EST/EDT)" },
  { value: "America/Chicago", label: "America/Chicago (CST/CDT)" },
  { value: "America/Denver", label: "America/Denver (MST/MDT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST/PDT)" },
  { value: "UTC", label: "UTC" },
];

interface AIToolDef {
  id: string;
  label: string;
  descKey: string;
  warningKey?: string;
}

const AI_TOOL_CATALOG: AIToolDef[] = [
  {
    id: "TodoWrite",
    label: "TodoWrite",
    descKey: "toolTodoWriteDesc",
    warningKey: "toolTodoWriteWarning",
  },
  { id: "Bash", label: "Bash", descKey: "toolBashDesc" },
  { id: "Read", label: "Read", descKey: "toolReadDesc" },
  { id: "Glob", label: "Glob", descKey: "toolGlobDesc" },
  { id: "Grep", label: "Grep", descKey: "toolGrepDesc" },
  { id: "WebFetch", label: "WebFetch", descKey: "toolWebFetchDesc" },
  { id: "WebSearch", label: "WebSearch", descKey: "toolWebSearchDesc" },
];

type ThemeDef = {
  id: ThemeName;
  name: string;
  sub: string;
  sidebar: string;
  surface: string;
  accent: string;
  fg: string;
  line: string;
  muted: string;
};

const DARK_THEMES_LIST: ThemeDef[] = [
  {
    id: "dark",
    name: "Dark",
    sub: "Datadog-like",
    sidebar: "#14151e",
    surface: "#1c1d2a",
    accent: "#8a5ff0",
    fg: "#e8eaf1",
    line: "#2a2c3d",
    muted: "#40435a",
  },
  {
    id: "midnight",
    name: "Midnight",
    sub: "Deep blue",
    sidebar: "#0f1424",
    surface: "#161d35",
    accent: "#4c8bf5",
    fg: "#e4ecff",
    line: "#232e52",
    muted: "#3a4680",
  },
  {
    id: "forest",
    name: "Forest",
    sub: "Pine green",
    sidebar: "#111d18",
    surface: "#1a2b23",
    accent: "#4ade80",
    fg: "#e6efe8",
    line: "#2a3d34",
    muted: "#436052",
  },
  {
    id: "sunset",
    name: "Sunset",
    sub: "Dusk pink",
    sidebar: "#1e1526",
    surface: "#2b1d36",
    accent: "#f472b6",
    fg: "#f3e8f7",
    line: "#3d2949",
    muted: "#6a4580",
  },
  {
    id: "ocean",
    name: "Ocean",
    sub: "Deep teal",
    sidebar: "#0c1d22",
    surface: "#142d36",
    accent: "#22d3ee",
    fg: "#e0f2f7",
    line: "#1f3b46",
    muted: "#395d6a",
  },
  {
    id: "slate",
    name: "Slate",
    sub: "Neutral gray",
    sidebar: "#181b20",
    surface: "#23272f",
    accent: "#94a3b8",
    fg: "#e6e8ec",
    line: "#2e333d",
    muted: "#4a515e",
  },
];

const LIGHT_THEMES_LIST: ThemeDef[] = [
  {
    id: "beige",
    name: "Beige",
    sub: "Warm classic",
    sidebar: "#ebe6de",
    surface: "#ffffff",
    accent: "#9a5b2f",
    fg: "#2c2825",
    line: "#e0dbd4",
    muted: "#b5afa6",
  },
  {
    id: "paper",
    name: "Paper",
    sub: "Clean white",
    sidebar: "#f1f1f1",
    surface: "#ffffff",
    accent: "#111827",
    fg: "#1f2937",
    line: "#e5e7eb",
    muted: "#9ca3af",
  },
  {
    id: "mint",
    name: "Mint",
    sub: "Fresh green",
    sidebar: "#e4f0e8",
    surface: "#ffffff",
    accent: "#15803d",
    fg: "#1a2e23",
    line: "#d7e6dc",
    muted: "#98b5a3",
  },
  {
    id: "rose",
    name: "Rose",
    sub: "Soft pink",
    sidebar: "#f8e4e7",
    surface: "#ffffff",
    accent: "#be185d",
    fg: "#3c1f26",
    line: "#f0d7dc",
    muted: "#c09ba3",
  },
  {
    id: "sky",
    name: "Sky",
    sub: "Airy blue",
    sidebar: "#dfebf6",
    surface: "#ffffff",
    accent: "#0369a1",
    fg: "#102030",
    line: "#d1e0ed",
    muted: "#8fa8bd",
  },
  {
    id: "sand",
    name: "Sand",
    sub: "Warm yellow",
    sidebar: "#f6ecd2",
    surface: "#ffffff",
    accent: "#a16207",
    fg: "#3b2f18",
    line: "#ece0c4",
    muted: "#b5a57c",
  },
];

function ThemeOption({
  t,
  active,
  onSelect,
}: {
  t: ThemeDef;
  active: boolean;
  onSelect: (id: ThemeName) => void;
}) {
  return (
    <button
      className={`theme-option ${active ? "theme-option--active" : ""}`}
      onClick={() => onSelect(t.id)}
      type="button"
    >
      <div className="theme-preview" style={{ borderColor: t.line }}>
        <div
          className="theme-preview-sidebar"
          style={{ background: t.sidebar }}
        />
        <div
          className="theme-preview-body"
          style={{ background: t.surface }}
        >
          <div
            className="theme-preview-line"
            style={{ background: t.fg, opacity: 0.8 }}
          />
          <div
            className="theme-preview-line theme-preview-line--short"
            style={{ background: t.muted }}
          />
          <div
            className="theme-preview-line theme-preview-line--pill"
            style={{ background: t.accent }}
          />
        </div>
      </div>
      <div className="theme-option-name">{t.name}</div>
      <div className="theme-option-sub">{t.sub}</div>
    </button>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return formatDateTime(d);
  } catch {
    return iso;
  }
}

export function SettingsPanel({
  theme,
  setTheme,
  language,
  setLanguage,
  githubStatus,
  githubRepos,
  onRequestRepoList,
  onLinkRepo,
  onUnlink,
  onSyncNow,
  onPullNow,
  onToggleAutoSync,
  aiConfig,
  onUpdateAIConfig,
  dayBoundaryHour,
  onDayBoundaryHourChange,
  calendarWeekStart,
  onCalendarWeekStartChange,
  timezone,
  onTimezoneChange,
}: Props) {
  const { t } = useTranslation("settings");
  const toggleTool = (toolId: string, enabled: boolean) => {
    const current = new Set(aiConfig.allowedTools);
    if (enabled) current.add(toolId);
    else current.delete(toolId);
    // カタログ順に並べ直す
    const next = AI_TOOL_CATALOG.filter((t) => current.has(t.id)).map(
      (t) => t.id,
    );
    onUpdateAIConfig({ ...aiConfig, allowedTools: next });
  };
  const toggleGhApi = (enabled: boolean) => {
    onUpdateAIConfig({ ...aiConfig, allowGhApi: enabled });
  };
  const bashEnabled = aiConfig.allowedTools.includes("Bash");
  return (
    <div className="settings-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">{t("pageTitle")}</h1>
          <div className="page-subtitle">{t("pageSubtitle")}</div>
        </div>
      </div>

      <div className="page-body">
        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">{t("appearance")}</span>
          </div>
          <div className="widget-body">
            <div className="settings-row">
              <div>
                <div className="settings-row-label">{t("language")}</div>
                <div className="settings-row-desc">{t("languageDesc")}</div>
              </div>
              <div className="theme-switch">
                <button
                  type="button"
                  className={`theme-option ${
                    language === "ja" ? "theme-option--active" : ""
                  }`}
                  onClick={() => setLanguage("ja")}
                >
                  <div className="theme-option-name">{t("langJa")}</div>
                  <div className="theme-option-sub">JA</div>
                </button>
                <button
                  type="button"
                  className={`theme-option ${
                    language === "en" ? "theme-option--active" : ""
                  }`}
                  onClick={() => setLanguage("en")}
                >
                  <div className="theme-option-name">{t("langEn")}</div>
                  <div className="theme-option-sub">EN</div>
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">{t("theme")}</div>
                <div className="settings-row-desc">{t("themeDesc")}</div>
              </div>
              <div className="theme-groups">
                <div className="theme-group">
                  <div className="theme-group-label">{t("dark")}</div>
                  <div className="theme-switch">
                    {DARK_THEMES_LIST.map((themeDef) => (
                      <ThemeOption
                        key={themeDef.id}
                        t={themeDef}
                        active={theme === themeDef.id}
                        onSelect={setTheme}
                      />
                    ))}
                  </div>
                </div>
                <div className="theme-group">
                  <div className="theme-group-label">{t("light")}</div>
                  <div className="theme-switch">
                    {LIGHT_THEMES_LIST.map((themeDef) => (
                      <ThemeOption
                        key={themeDef.id}
                        t={themeDef}
                        active={theme === themeDef.id}
                        onSelect={setTheme}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">{t("timeline", "タイムライン")}</span>
          </div>
          <div className="widget-body">
            <div className="settings-row">
              <div>
                <div className="settings-row-label">
                  {t("dayBoundaryHour", "日の切り替え時刻")}
                </div>
                <div className="settings-row-desc">
                  {t(
                    "dayBoundaryHourDesc",
                    "この時刻を境に「今日」が切り替わります。(デフォルト: 4:00)",
                  )}
                </div>
              </div>
              <select
                className="detail-prop-select"
                value={dayBoundaryHour}
                onChange={(e) =>
                  onDayBoundaryHourChange(Number(e.target.value))
                }
              >
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">
                  {t("calendarWeekStart", "カレンダーの週始まり")}
                </div>
                <div className="settings-row-desc">
                  {t(
                    "calendarWeekStartDesc",
                    "月表示と週表示の先頭曜日を選びます。(デフォルト: 月曜)",
                  )}
                </div>
              </div>
              <select
                className="detail-prop-select"
                value={calendarWeekStart}
                onChange={(e) =>
                  onCalendarWeekStartChange(Number(e.target.value) === 0 ? 0 : 1)
                }
              >
                <option value={1}>{t("weekStartMonday", "月曜")}</option>
                <option value={0}>{t("weekStartSunday", "日曜")}</option>
              </select>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">
                  {t("timezone", "タイムゾーン")}
                </div>
                <div className="settings-row-desc">
                  {t(
                    "timezoneDesc",
                    "iCloud カレンダー等の繰り返しイベント展開で使う TZ。Auto はサーバーの環境 TZ を使います。",
                  )}
                </div>
              </div>
              <select
                className="detail-prop-select"
                value={timezone}
                onChange={(e) => onTimezoneChange(e.target.value)}
              >
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">{t("github")}</span>
          </div>
          <div className="widget-body">
            <GitHubSection
              status={githubStatus}
              repos={githubRepos}
              onRequestRepoList={onRequestRepoList}
              onLinkRepo={onLinkRepo}
              onUnlink={onUnlink}
              onSyncNow={onSyncNow}
              onPullNow={onPullNow}
              onToggleAutoSync={onToggleAutoSync}
            />
          </div>
        </div>

        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">{t("aiAgent")}</span>
          </div>
          <div className="widget-body">
            <div className="settings-row-desc" style={{ marginBottom: 12 }}>
              {t("aiAgentDesc")}
            </div>
            <div className="ai-tool-list">
              {AI_TOOL_CATALOG.map((tool) => {
                const enabled = aiConfig.allowedTools.includes(tool.id);
                return (
                  <label key={tool.id} className="ai-tool-item">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleTool(tool.id, e.target.checked)}
                    />
                    <div className="ai-tool-text">
                      <div className="ai-tool-name">{tool.label}</div>
                      <div className="ai-tool-desc">{t(tool.descKey)}</div>
                      {tool.warningKey && (
                        <div className="ai-tool-warning">
                          ⚠ {t(tool.warningKey)}
                        </div>
                      )}
                      {tool.id === "Bash" && (
                        <label
                          className="ai-tool-suboption"
                          style={{
                            opacity: bashEnabled ? 1 : 0.5,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={aiConfig.allowGhApi}
                            disabled={!bashEnabled}
                            onChange={(e) => toggleGhApi(e.target.checked)}
                          />
                          <div>
                            <div className="ai-tool-name">
                              {t("ghApiName")}
                            </div>
                            <div className="ai-tool-desc">
                              {t("ghApiDesc")}
                            </div>
                            <div className="ai-tool-warning">
                              {t("ghApiWarning")}
                            </div>
                          </div>
                        </label>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GitHubSectionProps {
  status: GitHubStatus | null;
  repos: RepoInfo[];
  onRequestRepoList: () => void;
  onLinkRepo: Props["onLinkRepo"];
  onUnlink: () => void;
  onSyncNow: () => void;
  onPullNow: () => void;
  onToggleAutoSync: (v: boolean) => void;
}

function GitHubSection({
  status,
  repos,
  onRequestRepoList,
  onLinkRepo,
  onUnlink,
  onSyncNow,
  onPullNow,
  onToggleAutoSync,
}: GitHubSectionProps) {
  const { t } = useTranslation("settings");
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!status) {
    return <div className="settings-row-desc">{t("loading")}</div>;
  }

  if (!status.authOk) {
    return (
      <div className="gh-section">
        <div className="settings-row-label">{t("ghNotAuth")}</div>
        <div className="settings-row-desc">
          {t("ghAuthInstructionPre")}
          <code>gh auth login</code>
          {t("ghAuthInstructionPost")}
        </div>
        {status.authError && (
          <div className="gh-error">{status.authError}</div>
        )}
      </div>
    );
  }

  if (!status.linked) {
    return (
      <div className="gh-section">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t("ghNotLinked")}</div>
            <div className="settings-row-desc">
              {t("ghLoginHintPrefix")}
              <strong>{status.authUser}</strong>
              {t("ghLoginHintSuffix")}
              <code>todome.db</code>
              {t("ghLoginHintTail")}
            </div>
          </div>
          <button
            className="gh-btn gh-btn--primary"
            type="button"
            onClick={() => {
              onRequestRepoList();
              setPickerOpen(true);
            }}
          >
            {t("ghLinkBtn")}
          </button>
        </div>
        {status.lastError && <div className="gh-error">{status.lastError}</div>}
        {pickerOpen && (
          <RepoPicker
            repos={repos}
            defaultName="todome"
            onCancel={() => setPickerOpen(false)}
            onSelect={(owner, name) => {
              onLinkRepo({ owner, name, create: false, private: true });
              setPickerOpen(false);
            }}
            onCreate={(name, isPrivate) => {
              onLinkRepo({ name, create: true, private: isPrivate });
              setPickerOpen(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="gh-section">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">
            {t("ghLinkedLabel")}
            <a
              href={`https://github.com/${status.owner}/${status.repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {status.owner}/{status.repo}
            </a>
          </div>
          <div className="settings-row-desc">
            {status.syncing
              ? t("ghSyncing")
              : t("ghLastSync", { date: formatDate(status.lastSyncAt) })}
          </div>
        </div>
        <div className="gh-actions">
          <button
            className="gh-btn"
            type="button"
            onClick={onSyncNow}
            disabled={status.syncing}
          >
            {t("syncNow")}
          </button>
          <button
            className="gh-btn"
            type="button"
            onClick={onPullNow}
            disabled={status.syncing}
          >
            {t("pull")}
          </button>
          <button
            className="gh-btn gh-btn--danger"
            type="button"
            onClick={onUnlink}
            disabled={status.syncing}
          >
            {t("unlink")}
          </button>
        </div>
      </div>
      <div className="settings-row">
        <label className="gh-checkbox">
          <input
            type="checkbox"
            checked={status.autoSync}
            onChange={(e) => onToggleAutoSync(e.target.checked)}
          />
          <span>{t("autoSync")}</span>
        </label>
      </div>
      {status.lastError && <div className="gh-error">{status.lastError}</div>}
    </div>
  );
}

interface RepoPickerProps {
  repos: RepoInfo[];
  defaultName: string;
  onCancel: () => void;
  onSelect: (owner: string, name: string) => void;
  onCreate: (name: string, isPrivate: boolean) => void;
}

function RepoPicker({
  repos,
  defaultName,
  onCancel,
  onSelect,
  onCreate,
}: RepoPickerProps) {
  const { t } = useTranslation("settings");
  const [search, setSearch] = useState(defaultName);
  const [newName, setNewName] = useState(defaultName);
  const [newPrivate, setNewPrivate] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      r.nameWithOwner.toLowerCase().includes(q),
    );
  }, [repos, search]);

  return (
    <div className="gh-picker-overlay" onClick={onCancel}>
      <div className="gh-picker" onClick={(e) => e.stopPropagation()}>
        <div className="gh-picker-head">
          <h3>{t("repoPickerTitle")}</h3>
          <button className="gh-picker-close" type="button" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="gh-picker-section">
          <label className="gh-picker-label">{t("pickExisting")}</label>
          <input
            className="gh-picker-search"
            type="text"
            placeholder={t("pickSearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="gh-repo-list">
            {filtered.length === 0 ? (
              <div className="gh-repo-empty">
                {repos.length === 0
                  ? t("repoListLoading")
                  : t("repoListEmpty")}
              </div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.nameWithOwner}
                  className="gh-repo-row"
                  type="button"
                  onClick={() => onSelect(r.owner.login, r.name)}
                >
                  <span className="gh-repo-name">{r.nameWithOwner}</span>
                  {r.isPrivate && (
                    <span className="gh-repo-badge">{t("privateLabel")}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="gh-picker-section">
          <label className="gh-picker-label">{t("createNew")}</label>
          <div className="gh-picker-row">
            <input
              className="gh-picker-search"
              type="text"
              placeholder={t("repoNamePlaceholder")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <label className="gh-checkbox">
              <input
                type="checkbox"
                checked={newPrivate}
                onChange={(e) => setNewPrivate(e.target.checked)}
              />
              <span>{t("privateLabel")}</span>
            </label>
            <button
              className="gh-btn gh-btn--primary"
              type="button"
              disabled={!newName.trim()}
              onClick={() => onCreate(newName.trim(), newPrivate)}
            >
              {t("createAndLink")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
