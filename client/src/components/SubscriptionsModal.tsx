import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CalDAVCalendarChoice,
  CalDAVStatus,
  CalendarSubscription,
  GoogleCalendarChoice,
  GoogleStatus,
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
  googleStatus: GoogleStatus | null;
  googleCalendars: GoogleCalendarChoice[];
  googleCalendarsError: string;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * エラー文に含まれる http(s) URL を <a> に変換する。
 * Google API の SERVICE_DISABLED 案内のように、有効化 URL をワンクリックで
 * 開けるようにするためのもの。
 */
function renderErrorWithLinks(text: string): React.ReactNode {
  // URL の末尾に句読点が付いて誤検出するのを避ける
  const re = /(https?:\/\/[^\s)]+[^\s).,])/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a
        key={`u-${key++}`}
        href={match[0]}
        target="_blank"
        rel="noreferrer noopener"
      >
        {match[0]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
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
  googleStatus,
  googleCalendars,
  googleCalendarsError,
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

  // Google connect form。client_id / client_secret はサーバ側に保存済みでも
  // 編集できるようにここで持つが、初回マウント時はサーバ側の hasCredentials を信用する。
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleCalendarsOpen, setGoogleCalendarsOpen] = useState(false);
  const [googleRedirectCopied, setGoogleRedirectCopied] = useState(false);
  const activeGoogleAccountId = googleStatus?.activeAccountId ?? "";
  const googleAccounts = googleStatus?.accounts ?? [];
  const activeGoogleAccount =
    googleAccounts.find((account) => account.id === activeGoogleAccountId) ??
    googleAccounts[0];
  const activeGoogleCalendars = googleCalendars.filter(
    (cal) => !activeGoogleAccount?.id || cal.accountId === activeGoogleAccount.id,
  );

  const handleCopyGoogleRedirect = async () => {
    const uri = googleStatus?.redirectUri ?? "";
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
    } catch {
      // clipboard API がブロックされる環境向けの fallback
      const ta = document.createElement("textarea");
      ta.value = uri;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // ignore
      }
      ta.remove();
    }
    setGoogleRedirectCopied(true);
    window.setTimeout(() => setGoogleRedirectCopied(false), 1500);
  };

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
      googleCalendarId: "",
      googleAccountId: "",
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
      googleCalendarId: "",
      googleAccountId: "",
    };
    send({ type: "subscription_add", subscription: sub });
  };

  const handleToggleCalDAVCalendar = (
    cal: CalDAVCalendarChoice,
    checked: boolean,
  ) => {
    if (checked) {
      handleSubscribeCalendar(cal);
      return;
    }
    const sub = subscriptions.find((s) => s.url === cal.url);
    if (sub) handleDelete(sub.id);
  };

  // --- Google handlers ---

  const handleGoogleSaveCredentials = () => {
    const cid = googleClientId.trim();
    const csec = googleClientSecret.trim();
    if (!cid || !csec) return;
    send({
      type: "google_set_credentials",
      clientId: cid,
      clientSecret: csec,
    });
    // 入力値を保持しておくと再表示で平文が見えるのでクリアする
    setGoogleClientId("");
    setGoogleClientSecret("");
  };

  const handleGoogleConnect = () => {
    send({ type: "google_connect_start" });
  };

  const handleGoogleActiveAccountChange = (accountId: string) => {
    send({ type: "google_set_active_account", accountId });
    setGoogleCalendarsOpen(false);
  };

  const handleGoogleDisconnect = (accountId?: string) => {
    if (!confirm(t("googleDisconnectConfirm"))) return;
    send({ type: "google_disconnect", accountId: accountId ?? "" });
    setGoogleCalendarsOpen(false);
  };

  const handleGoogleListCalendars = () => {
    send({ type: "google_list_calendars", accountId: activeGoogleAccount?.id ?? "" });
    setGoogleCalendarsOpen(true);
  };

  const handleGoogleSetWriteTarget = (
    id: string,
    name: string,
    color: string,
  ) => {
    send({
      type: "google_set_write_target",
      accountId: activeGoogleAccount?.id ?? "",
      calendarId: id,
      calendarName: name,
      calendarColor: color,
    });
  };

  const handleSubscribeGoogleCalendar = (cal: GoogleCalendarChoice) => {
    const accountId = cal.accountId || activeGoogleAccount?.id || "";
    // 同じアカウントの同じ googleCalendarId が既にあれば追加しない
    if (
      subscriptions.some(
        (s) =>
          s.provider === "google" &&
          s.googleCalendarId === cal.id &&
          s.googleAccountId === accountId,
      )
    )
      return;
    const now = nowLocalIso();
    const sub: CalendarSubscription = {
      id: generateId(),
      name: cal.displayName || cal.id,
      // ICS/CalDAV と統一するため、表示用に calendarId を url 欄にも入れる
      url: `google:${cal.id}`,
      color: cal.color || pickColor(subscriptions),
      enabled: true,
      lastFetchedAt: "",
      lastError: "",
      status: "idle",
      eventCount: 0,
      createdAt: now,
      updatedAt: now,
      provider: "google",
      caldavCalendarId: "",
      googleCalendarId: cal.id,
      googleAccountId: accountId,
    };
    send({ type: "subscription_add", subscription: sub });
  };

  const handleToggleGoogleCalendar = (
    cal: GoogleCalendarChoice,
    checked: boolean,
  ) => {
    if (checked) {
      handleSubscribeGoogleCalendar(cal);
      return;
    }
    const sub = subscriptions.find(
      (s) =>
        s.provider === "google" &&
        s.googleCalendarId === cal.id &&
        s.googleAccountId === (cal.accountId || activeGoogleAccount?.id || ""),
    );
    if (sub) handleDelete(sub.id);
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
                            <label className="calendar-subscription-toggle">
                              <input
                                type="checkbox"
                                checked={subscribed}
                                onChange={(e) =>
                                  handleToggleCalDAVCalendar(
                                    cal,
                                    e.target.checked,
                                  )
                                }
                              />
                              <span>
                                {subscribed
                                  ? t("calendarToggleAdded")
                                  : t("calendarToggleAdd")}
                              </span>
                            </label>
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

        {/* Google Calendar 連携セクション */}
        <section className="subscriptions-section">
          <h3 className="subscriptions-section-title">{t("googleTitle")}</h3>
          {googleStatus?.connected ? (
            <div className="caldav-connected">
              <div className="caldav-connected-row">
                <span className="caldav-status-badge">
                  {t("googleConnected")}
                </span>
                <select
                  className="detail-prop-select"
                  value={activeGoogleAccount?.id ?? ""}
                  onChange={(e) => handleGoogleActiveAccountChange(e.target.value)}
                >
                  {googleAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountEmail || account.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={handleGoogleListCalendars}
                >
                  {t("googleListCalendars")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleGoogleConnect}
                >
                  {t("googleAddAccount")}
                </button>
                <button
                  type="button"
                  className="btn schedule-editor-delete"
                  onClick={() => handleGoogleDisconnect(activeGoogleAccount?.id)}
                >
                  {t("googleDisconnect")}
                </button>
              </div>
              <div className="caldav-write-target-row">
                <label className="caldav-write-target-label">
                  {t("googleWriteTarget")}
                </label>
                <select
                  className="detail-prop-select"
                  value={activeGoogleAccount?.writeTargetCalendarId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    const cal = activeGoogleCalendars.find((c) => c.id === id);
                    handleGoogleSetWriteTarget(
                      id,
                      cal?.displayName || "",
                      cal?.color || "",
                    );
                  }}
                  onFocus={() => {
                    if (activeGoogleCalendars.length === 0)
                      handleGoogleListCalendars();
                  }}
                >
                  <option value="">{t("googleWriteTargetNone")}</option>
                  {activeGoogleAccount?.writeTargetCalendarId &&
                    !activeGoogleCalendars.some(
                      (c) => c.id === activeGoogleAccount.writeTargetCalendarId,
                    ) && (
                      <option value={activeGoogleAccount.writeTargetCalendarId}>
                        {activeGoogleAccount.writeTargetCalendarName ||
                          activeGoogleAccount.writeTargetCalendarId}
                      </option>
                    )}
                  {activeGoogleCalendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.displayName}
                      {cal.primary ? ` (${t("googlePrimary")})` : ""}
                    </option>
                  ))}
                </select>
                <span className="caldav-write-target-hint">
                  {t("googleWriteTargetHint")}
                </span>
              </div>
              {googleStatus.lastError && (
                <div className="schedule-editor-error">
                  {renderErrorWithLinks(googleStatus.lastError)}
                </div>
              )}
              {googleCalendarsOpen && (
                <div className="caldav-calendar-list">
                  {googleCalendarsError && (
                    <div className="schedule-editor-error">
                      {renderErrorWithLinks(googleCalendarsError)}
                    </div>
                  )}
                  {activeGoogleCalendars.length === 0 && !googleCalendarsError ? (
                    <div className="subscriptions-modal-help">
                      {t("googleCalendarsLoading")}
                    </div>
                  ) : (
                    <ul>
                      {activeGoogleCalendars.map((cal) => {
                        const subscribed = subscriptions.some(
                          (s) =>
                            s.provider === "google" &&
                            s.googleCalendarId === cal.id &&
                            s.googleAccountId ===
                              (cal.accountId || activeGoogleAccount?.id || ""),
                        );
                        return (
                          <li key={cal.id} className="caldav-calendar-row">
                            <span
                              className="caldav-calendar-color"
                              style={{
                                background:
                                  cal.color || DEFAULT_SUBSCRIPTION_COLORS[0],
                              }}
                            />
                            <div className="caldav-calendar-name">
                              {cal.displayName}
                              {cal.primary && (
                                <span className="caldav-calendar-desc">
                                  {" "}
                                  ({t("googlePrimary")})
                                </span>
                              )}
                              {cal.description && (
                                <span className="caldav-calendar-desc">
                                  {" "}
                                  — {cal.description}
                                </span>
                              )}
                            </div>
                            <label className="calendar-subscription-toggle">
                              <input
                                type="checkbox"
                                checked={subscribed}
                                onChange={(e) =>
                                  handleToggleGoogleCalendar(
                                    cal,
                                    e.target.checked,
                                  )
                                }
                              />
                              <span>
                                {subscribed
                                  ? t("calendarToggleAdded")
                                  : t("calendarToggleAdd")}
                              </span>
                            </label>
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
              <p className="subscriptions-modal-help">{t("googleHelp")}</p>
              <div className="google-setup-links">
                <a
                  className="caldav-issue-link"
                  href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("googleEnableApiLink")}
                </a>
                <a
                  className="caldav-issue-link"
                  href="https://console.cloud.google.com/apis/credentials/consent"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("googleConsentScreenLink")}
                </a>
                <a
                  className="caldav-issue-link"
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t("googleIssueLink")}
                </a>
              </div>
              {googleStatus?.redirectUri && (
                <div className="google-redirect-uri">
                  <label className="schedule-editor-field">
                    <span>{t("googleRedirectUriLabel")}</span>
                    <div className="google-redirect-uri-row">
                      <input
                        type="text"
                        readOnly
                        value={googleStatus.redirectUri}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={handleCopyGoogleRedirect}
                      >
                        {googleRedirectCopied
                          ? t("googleRedirectUriCopied")
                          : t("googleRedirectUriCopy")}
                      </button>
                    </div>
                  </label>
                </div>
              )}
              {googleStatus?.hasCredentials ? (
                <>
                  <p className="subscriptions-modal-help">
                    {t("googleCredentialsSaved")}
                  </p>
                  {googleStatus.lastError && (
                    <div className="schedule-editor-error">
                      {googleStatus.lastError}
                    </div>
                  )}
                  <div className="caldav-connected-row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleGoogleConnect}
                    >
                      {t("googleConnect")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleGoogleDisconnect()}
                    >
                      {t("googleResetCredentials")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="schedule-editor-field">
                    <span>{t("googleClientId")}</span>
                    <input
                      type="text"
                      autoComplete="off"
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder="xxxxxxxxxx.apps.googleusercontent.com"
                    />
                  </label>
                  <label className="schedule-editor-field">
                    <span>{t("googleClientSecret")}</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={googleClientSecret}
                      onChange={(e) => setGoogleClientSecret(e.target.value)}
                      placeholder="GOCSPX-..."
                    />
                  </label>
                  {googleStatus?.lastError && (
                    <div className="schedule-editor-error">
                      {googleStatus.lastError}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleGoogleSaveCredentials}
                    disabled={
                      !googleClientId.trim() || !googleClientSecret.trim()
                    }
                  >
                    {t("googleSaveCredentials")}
                  </button>
                </>
              )}
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
                  {sub.provider === "caldav"
                    ? t("providerCaldav")
                    : sub.provider === "google"
                      ? t("providerGoogle")
                      : t("providerIcs")}
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
