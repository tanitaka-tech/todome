import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Quota } from "../types";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  quota: Quota | null;
  onSave: (q: Quota) => void;
  onClose: () => void;
}

export function QuotaEditor({ quota, onSave, onClose }: Props) {
  const { t } = useTranslation("quota");
  const [name, setName] = useState(quota?.name ?? "");
  const [icon, setIcon] = useState(quota?.icon ?? "🎯");
  const [target, setTarget] = useState<number>(quota?.targetMinutes ?? 30);
  const overlayMouseDownRef = useRef(false);
  const { closing, close } = useModalClose(onClose);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSave({
      id: quota?.id ?? "",
      name: trimmedName,
      icon: icon.trim() || "🎯",
      targetMinutes: Math.max(0, Math.floor(target) || 0),
      archived: quota?.archived ?? false,
      createdAt: quota?.createdAt ?? "",
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
            {quota ? t("editQuota") : t("newQuota")}
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
              <div className="detail-prop-label">{t("targetMinutes")}</div>
              <div className="detail-prop-value">
                <input
                  className="detail-prop-input detail-prop-input--num"
                  type="number"
                  min={0}
                  value={target}
                  onChange={(e) =>
                    setTarget(Math.max(0, Number(e.target.value) || 0))
                  }
                />
                <span className="detail-prop-meta">{t("targetHint")}</span>
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
