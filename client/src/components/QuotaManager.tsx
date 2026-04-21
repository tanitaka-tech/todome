import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Quota } from "../types";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  quotas: Quota[];
  onEdit: (q: Quota) => void;
  onDelete: (id: string) => void;
  onArchiveToggle: (q: Quota) => void;
  onReorder: (ids: string[]) => void;
  onAddNew: () => void;
  onClose: () => void;
}

export function QuotaManager({
  quotas,
  onEdit,
  onDelete,
  onArchiveToggle,
  onReorder,
  onAddNew,
  onClose,
}: Props) {
  const { t } = useTranslation("quota");
  const overlayMouseDownRef = useRef(false);
  const { closing, close } = useModalClose(onClose);

  const move = (idx: number, direction: -1 | 1) => {
    const to = idx + direction;
    if (to < 0 || to >= quotas.length) return;
    const ids = quotas.map((q) => q.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  };

  const handleDelete = (q: Quota) => {
    if (window.confirm(t("deleteConfirm", { name: q.name }))) {
      onDelete(q.id);
    }
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
        className="modal-content modal-content--life-manager"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-topbar">
          <div className="detail-topbar-title">{t("manageTitle")}</div>
          <button className="modal-close" onClick={close} aria-label={t("close")}>
            &times;
          </button>
        </div>

        <div className="detail-body">
          <div className="life-manager-list">
            {quotas.map((q, idx) => (
              <div
                key={q.id}
                className={`life-manager-row${q.archived ? " is-archived" : ""}`}
              >
                <div className="life-manager-row-main">
                  <span className="life-manager-icon">{q.icon}</span>
                  <span className="life-manager-name">
                    {q.name}
                    {q.archived && (
                      <span className="life-manager-archived-label">
                        {" "}
                        {t("archivedLabel")}
                      </span>
                    )}
                  </span>
                </div>
                <div className="life-manager-row-actions">
                  <button
                    className="life-manager-btn"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    title={t("moveUp")}
                  >
                    ↑
                  </button>
                  <button
                    className="life-manager-btn"
                    onClick={() => move(idx, 1)}
                    disabled={idx === quotas.length - 1}
                    title={t("moveDown")}
                  >
                    ↓
                  </button>
                  <button
                    className="life-manager-btn"
                    onClick={() => onEdit(q)}
                  >
                    ✎
                  </button>
                  <button
                    className="life-manager-btn"
                    onClick={() => onArchiveToggle(q)}
                  >
                    {q.archived ? t("restore") : t("archive")}
                  </button>
                  <button
                    className="life-manager-btn life-manager-btn--danger"
                    onClick={() => handleDelete(q)}
                  >
                    {t("delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="life-activity-editor-actions">
            <button className="kanban-add-cancel" onClick={close}>
              {t("close")}
            </button>
            <button className="kanban-add-submit" onClick={onAddNew}>
              {t("addQuota")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
