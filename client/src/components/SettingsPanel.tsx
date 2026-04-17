import type { ThemeName } from "../theme";

interface Props {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

const THEMES: {
  id: ThemeName;
  name: string;
  sub: string;
  sidebar: string;
  surface: string;
  accent: string;
  fg: string;
  line: string;
  muted: string;
}[] = [
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
];

export function SettingsPanel({ theme, setTheme }: Props) {
  return (
    <div className="settings-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">設定</h1>
          <div className="page-subtitle">アプリの外観と挙動を設定します</div>
        </div>
      </div>

      <div className="page-body">
        <div className="widget" style={{ maxWidth: 720 }}>
          <div className="widget-head">
            <span className="widget-title">Appearance</span>
          </div>
          <div className="widget-body">
            <div className="settings-row">
              <div>
                <div className="settings-row-label">テーマ</div>
                <div className="settings-row-desc">
                  全体の配色を切り替えます。設定はこのブラウザに保存されます。
                </div>
              </div>
              <div className="theme-switch">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-option ${
                      theme === t.id ? "theme-option--active" : ""
                    }`}
                    onClick={() => setTheme(t.id)}
                    type="button"
                  >
                    <div
                      className="theme-preview"
                      style={{ borderColor: t.line }}
                    >
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
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
