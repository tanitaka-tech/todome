import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LifeActivity, LifeCategory, LifeLimitScope } from "../types";
import { LIFE_CATEGORIES, LIFE_CATEGORY_LABELS, LIFE_LIMIT_SCOPE_LABELS } from "../types";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  activity: LifeActivity | null; // null = new
  onSave: (a: LifeActivity) => void;
  onClose: () => void;
}

const SCOPES: LifeLimitScope[] = ["per_session", "per_day"];

export function LifeActivityEditor({ activity, onSave, onClose }: Props) {
  const { t } = useTranslation("lifeLog");
  const [name, setName] = useState(activity?.name ?? "");
  const [icon, setIcon] = useState(activity?.icon ?? "⏱");
  const [category, setCategory] = useState<LifeCategory>(
    activity?.category ?? "other",
  );
  const [soft, setSoft] = useState<number>(activity?.softLimitMinutes ?? 0);
  const [hard, setHard] = useState<number>(activity?.hardLimitMinutes ?? 0);
  const [scope, setScope] = useState<LifeLimitScope>(
    activity?.limitScope ?? "per_session",
  );
  const overlayMouseDownRef = useRef(false);
  const { closing, close } = useModalClose(onClose);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSave({
      id: activity?.id ?? "",
      name: trimmedName,
      icon: icon.trim() || "⏱",
      category,
      softLimitMinutes: Math.max(0, Math.floor(soft) || 0),
      hardLimitMinutes: Math.max(0, Math.floor(hard) || 0),
      limitScope: scope,
      archived: activity?.archived ?? false,
    });
  };

  return (
    <div
      className={`modal-overlay${closing ? " is-closing" : ""}`}
      onMouseDown={(e) => {
        overlayMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayMouseDownRef.current) {
          close();
        }
      }}
    >
      <div
        className="modal-content modal-content--life-activity"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-topbar">
          <div className="detail-topbar-title">
            {activity ? t("editActivity") : t("newActivity")}
          </div>
          <button className="modal-close" onClick={close} aria-label={t("close")}>
            &times;
          </button>
        </div>

        <div className="detail-body">
          <div className="detail-properties">
            <div className="detail-prop">
              <div className="detail-prop-label">{t("icon")}</div>
              <div className="detail-prop-value">
                <input
                  className="life-activity-icon-input"
                  value={icon}
                  maxLength={4}
                  onChange={(e) => setIcon(e.target.value)}
                />
              </div>
            </div>

            <div className="detail-prop">
              <div className="detail-prop-label">{t("name")}</div>
              <div className="detail-prop-value">
                <input
                  className="detail-prop-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("name")}
                  autoFocus
                />
              </div>
            </div>

            <div className="detail-prop">
              <div className="detail-prop-label">{t("category")}</div>
              <div className="detail-prop-value">
                <select
                  className="detail-prop-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as LifeCategory)}
                >
                  {LIFE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`category${c[0].toUpperCase()}${c.slice(1)}`) || LIFE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="detail-prop">
              <div className="detail-prop-label">{t("softLimit")}</div>
              <div className="detail-prop-value">
                <input
                  className="detail-prop-input detail-prop-input--num"
                  type="number"
                  min={0}
                  value={soft}
                  onChange={(e) =>
                    setSoft(Math.max(0, Number(e.target.value) || 0))
                  }
                />
                <span className="detail-prop-meta">{t("limitHint")}</span>
              </div>
            </div>

            <div className="detail-prop">
              <div className="detail-prop-label">{t("hardLimit")}</div>
              <div className="detail-prop-value">
                <input
                  className="detail-prop-input detail-prop-input--num"
                  type="number"
                  min={0}
                  value={hard}
                  onChange={(e) =>
                    setHard(Math.max(0, Number(e.target.value) || 0))
                  }
                />
                <span className="detail-prop-meta">{t("limitHint")}</span>
              </div>
            </div>

            <div className="detail-prop">
              <div className="detail-prop-label">{t("limitScope")}</div>
              <div className="detail-prop-value">
                <div className="life-activity-scope-group">
                  {SCOPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`life-activity-scope-chip${
                        scope === s ? " is-active" : ""
                      }`}
                      onClick={() => setScope(s)}
                    >
                      {t(
                        s === "per_session" ? "scopePerSession" : "scopePerDay",
                      ) || LIFE_LIMIT_SCOPE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="life-activity-editor-actions">
            <button className="kanban-add-cancel" onClick={close}>
              {t("cancel")}
            </button>
            <button
              className="kanban-add-submit"
              onClick={handleSave}
              disabled={!name.trim()}
            >
              {t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
