import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CalendarSubscription, SubscriptionStatus } from "../types";
import {
  DEFAULT_SUBSCRIPTION_COLORS,
  nowLocalIso,
} from "../types";

interface Props {
  subscriptions: CalendarSubscription[];
  send: (data: unknown) => void;
  onClose: () => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function pickColor(existing: CalendarSubscription[]): string {
  for (const c of DEFAULT_SUBSCRIPTION_COLORS) {
    if (!existing.some((s) => s.color === c)) return c;
  }
  return DEFAULT_SUBSCRIPTION_COLORS[0];
}

function statusLabelKey(s: SubscriptionStatus): string {
  return `status_${s}`;
}

export function SubscriptionsModal({
  subscriptions,
  send,
  onClose,
}: Props) {
  const { t } = useTranslation("schedule");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const handleAdd = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError(t("needUrl"));
      return;
    }
    const now = nowLocalIso();
    const sub: CalendarSubscription = {
      id: generateId(),
      name: name.trim() || trimmedUrl,
      url: trimmedUrl,
      color: pickColor(subscriptions),
      enabled: true,
      lastFetchedAt: "",
      lastError: "",
      status: "idle",
      eventCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    send({ type: "subscription_add", subscription: sub });
    setName("");
    setUrl("");
    setError("");
  };

  const handleEdit = (next: CalendarSubscription) => {
    send({
      type: "subscription_edit",
      subscription: { ...next, updatedAt: nowLocalIso() },
    });
  };

  const handleDelete = (id: string) => {
    send({ type: "subscription_delete", subscriptionId: id });
  };

  const handleRefresh = (id?: string) => {
    send({ type: "subscription_refresh", subscriptionId: id ?? "" });
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content subscriptions-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="subscriptions-modal-header">
          <h2>{t("subscriptionsTitle")}</h2>
          <button
            type="button"
            className="btn"
            onClick={() => handleRefresh()}
            disabled={subscriptions.length === 0}
          >
            {t("refreshAll")}
          </button>
        </header>

        <p className="subscriptions-modal-help">{t("subscriptionsHelp")}</p>

        <div className="subscriptions-add">
          <label className="schedule-editor-field">
            <span>{t("subFieldName")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My calendar"
            />
          </label>
          <label className="schedule-editor-field">
            <span>{t("subFieldUrl")}</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            />
          </label>
          {error && <div className="schedule-editor-error">{error}</div>}
          <button type="button" className="btn btn--primary" onClick={handleAdd}>
            + {t("addSubscription")}
          </button>
        </div>

        <ul className="subscriptions-list">
          {subscriptions.map((sub) => (
            <li key={sub.id} className="subscriptions-item">
              <div className="subscriptions-item-row">
                <input
                  type="color"
                  value={sub.color || DEFAULT_SUBSCRIPTION_COLORS[0]}
                  onChange={(e) =>
                    handleEdit({ ...sub, color: e.target.value })
                  }
                />
                <input
                  type="text"
                  className="subscriptions-item-name"
                  value={sub.name}
                  onChange={(e) =>
                    handleEdit({ ...sub, name: e.target.value })
                  }
                />
                <label className="subscriptions-item-enabled">
                  <input
                    type="checkbox"
                    checked={sub.enabled}
                    onChange={(e) =>
                      handleEdit({ ...sub, enabled: e.target.checked })
                    }
                  />
                  <span>{t("subFieldEnabled")}</span>
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleRefresh(sub.id)}
                  disabled={sub.status === "fetching"}
                >
                  {t("refresh")}
                </button>
                <button
                  type="button"
                  className="btn schedule-editor-delete"
                  onClick={() => handleDelete(sub.id)}
                >
                  {t("delete")}
                </button>
              </div>
              <div className="subscriptions-item-url">
                <code>{sub.url}</code>
              </div>
              <div className="subscriptions-item-meta">
                <span
                  className={`subscriptions-status subscriptions-status--${sub.status}`}
                >
                  {t(statusLabelKey(sub.status))}
                </span>
                <span>
                  {t("lastFetchedAt")}: {sub.lastFetchedAt || "—"}
                </span>
                <span>
                  {t("eventCount", { count: sub.eventCount })}
                </span>
                {sub.lastError && (
                  <span className="subscriptions-item-error">
                    {sub.lastError}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <footer className="subscriptions-modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t("close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
