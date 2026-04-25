import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CalDAVCalendarChoice,
  CalDAVStatus,
  CalendarSubscription,
  SubscriptionStatus,
} from "../types";
import {
  DEFAULT_SUBSCRIPTION_COLORS,
  nowLocalIso,
} from "../types";

interface Props {
  subscriptions: CalendarSubscription[];
  send: (data: unknown) => void;
  onClose: () => void;
  caldavStatus: CalDAVStatus | null;
  caldavCalendars: CalDAVCalendarChoice[];
  caldavCalendarsError: string;
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
  caldavStatus,
  caldavCalendars,
  caldavCalendarsError,
}: Props) {
  const { t } = useTranslation("schedule");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  // iCloud connect form。接続成功するとフォーム自体が unmount されるので、
  // 入力値の明示クリアは不要。
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [calendarsOpen, setCalendarsOpen] = useState(false);

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
      provider: "ics",
      caldavCalendarId: "",
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

  const handleConnect = () => {
    if (!appleId.trim() || !appPassword.trim()) return;
    send({
      type: "caldav_connect",
      appleId: appleId.trim(),
      appPassword: appPassword.trim(),
    });
  };

  const handleDisconnect = () => {
    if (!confirm(t("caldavDisconnectConfirm"))) return;
    send({ type: "caldav_disconnect" });
  };

  const handleListCalendars = () => {
    send({ type: "caldav_list_calendars" });
    setCalendarsOpen(true);
  };

  const handleSetWriteTarget = (
    url: string,
    name: string,
    color: string,
  ) => {
    send({
      type: "caldav_set_write_target",
      calendarUrl: url,
      calendarName: name,
      calendarColor: color,
    });
  };

  const handleSubscribeCalendar = (cal: CalDAVCalendarChoice) => {
    // 同じ url が既にあれば追加しない
    if (subscriptions.some((s) => s.url === cal.url)) return;
    const now = nowLocalIso();
    const sub: CalendarSubscription = {
      id: generateId(),
      name: cal.displayName || cal.url,
      url: cal.url,
      color: cal.color || pickColor(subscriptions),
      enabled: true,
      lastFetchedAt: "",
      lastError: "",
      status: "idle",
      eventCount: 0,
      createdAt: now,
      updatedAt: now,
      provider: "caldav",
      caldavCalendarId: cal.displayName || "",
    };
    send({ type: "subscription_add", subscription: sub });
  };

  const subscribedUrls = new Set(subscriptions.map((s) => s.url));

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

        {/* iCloud (CalDAV) 連携セクション */}
        <section className="subscriptions-section">
          <h3 className="subscriptions-section-title">{t("caldavTitle")}</h3>
          {caldavStatus?.connected ? (
            <div className="caldav-connected">
              <div className="caldav-connected-row">
                <span className="caldav-status-badge">{t("caldavConnected")}</span>
                <span className="caldav-account">{caldavStatus.appleId}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={handleListCalendars}
                >
                  {t("caldavListCalendars")}
                </button>
                <button
                  type="button"
                  className="btn schedule-editor-delete"
                  onClick={handleDisconnect}
                >
                  {t("caldavDisconnect")}
                </button>
              </div>
              <div className="caldav-write-target-row">
                <label className="caldav-write-target-label">
                  {t("caldavWriteTarget")}
                </label>
                <select
                  className="detail-prop-select"
                  value={caldavStatus.writeTargetCalendarUrl}
                  onChange={(e) => {
                    const url = e.target.value;
                    const cal = caldavCalendars.find((c) => c.url === url);
                    handleSetWriteTarget(
                      url,
                      cal?.displayName || "",
                      cal?.color || "",
                    );
                  }}
                  onFocus={() => {
                    // 一覧未取得ならフォーカス時に取得
                    if (caldavCalendars.length === 0) handleListCalendars();
                  }}
                >
                  <option value="">{t("caldavWriteTargetNone")}</option>
                  {caldavStatus.writeTargetCalendarUrl &&
                    !caldavCalendars.some(
                      (c) => c.url === caldavStatus.writeTargetCalendarUrl,
                    ) && (
                      <option value={caldavStatus.writeTargetCalendarUrl}>
                        {caldavStatus.writeTargetCalendarName ||
                          caldavStatus.writeTargetCalendarUrl}
                      </option>
                    )}
                  {caldavCalendars.map((cal) => (
                    <option key={cal.url} value={cal.url}>
                      {cal.displayName}
                    </option>
                  ))}
                </select>
                <span className="caldav-write-target-hint">
                  {t("caldavWriteTargetHint")}
                </span>
              </div>
              {caldavStatus.lastError && (
                <div className="schedule-editor-error">
                  {caldavStatus.lastError}
                </div>
              )}
              {calendarsOpen && (
                <div className="caldav-calendar-list">
                  {caldavCalendarsError && (
                    <div className="schedule-editor-error">
                      {caldavCalendarsError}
                    </div>
                  )}
                  {caldavCalendars.length === 0 && !caldavCalendarsError ? (
                    <div className="subscriptions-modal-help">
                      {t("caldavCalendarsLoading")}
                    </div>
                  ) : (
                    <ul>
                      {caldavCalendars.map((cal) => {
                        const subscribed = subscribedUrls.has(cal.url);
                        return (
                          <li key={cal.url} className="caldav-calendar-row">
                            <span
                              className="caldav-calendar-color"
                              style={{
                                background:
                                  cal.color || DEFAULT_SUBSCRIPTION_COLORS[0],
                              }}
                            />
                            <div className="caldav-calendar-name">
                              {cal.displayName}
                              {cal.description && (
                                <span className="caldav-calendar-desc">
                                  {" "}— {cal.description}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn btn--primary"
                              disabled={subscribed}
                              onClick={() => handleSubscribeCalendar(cal)}
                            >
                              {subscribed
                                ? t("caldavAlreadyAdded")
                                : t("caldavAddCalendar")}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="caldav-connect-form">
              <p className="subscriptions-modal-help">{t("caldavHelp")}</p>
              <a
                className="caldav-issue-link"
                href="https://account.apple.com/account/manage"
                target="_blank"
                rel="noreferrer noopener"
              >
                {t("caldavIssueLink")}
              </a>
              <label className="schedule-editor-field">
                <span>{t("caldavAppleId")}</span>
                <input
                  type="email"
                  autoComplete="username"
                  value={appleId}
                  onChange={(e) => setAppleId(e.target.value)}
                  placeholder="example@icloud.com"
                />
              </label>
              <label className="schedule-editor-field">
                <span>{t("caldavAppPassword")}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                />
              </label>
              {caldavStatus?.lastError && (
                <div className="schedule-editor-error">
                  {caldavStatus.lastError}
                </div>
              )}
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleConnect}
                disabled={!appleId.trim() || !appPassword.trim()}
              >
                {t("caldavConnect")}
              </button>
            </div>
          )}
        </section>

        {/* 公開 iCal URL 購読セクション */}
        <section className="subscriptions-section">
          <h3 className="subscriptions-section-title">{t("icsTitle")}</h3>
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
        </section>

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
                <span className={`subscriptions-provider subscriptions-provider--${sub.provider}`}>
                  {sub.provider === "caldav" ? t("providerCaldav") : t("providerIcs")}
                </span>
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
