import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AIToolConfig,
  AskUserRequest,
  ChatMessage,
  GitHubStatus,
  Goal,
  KanbanTask,
  RepoInfo,
  Retrospective,
  RetroType,
  UserProfile,
  WSMessage,
} from "../types";
import { formatDuration, totalSeconds } from "../types";
import { applyTheme, getInitialTheme, type ThemeName } from "../theme";
import { useWebSocket } from "../hooks/useWebSocket";
import { KanbanBoard } from "./KanbanBoard";
import { ChatPanel } from "./ChatPanel";
import { TaskDetailModal } from "./TaskDetailModal";
import { GoalPanel } from "./GoalPanel";
import { ProfilePanel } from "./ProfilePanel";
import { StatsPanel } from "./StatsPanel";
import { OverviewPanel } from "./OverviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { RetroPanel } from "./RetroPanel";
import { GitHubSyncTab } from "./GitHubSyncTab";

let msgId = 0;
const nextId = () => String(++msgId);

type ActiveView =
  | "overview"
  | "board"
  | "goals"
  | "retro"
  | "stats"
  | "profile"
  | "settings";

const EMPTY_PROFILE: UserProfile = {
  currentState: "",
  balanceWheel: [],
  actionPrinciples: [],
  wantToDo: [],
};

const PRAISE_MESSAGES = [
  "Great job!",
  "Well done!",
  "Nice work!",
  "Keep it up!",
  "Awesome!",
  "You did it!",
  "Fantastic!",
  "Impressive!",
];

interface Celebration {
  id: number;
  title: string;
  duration: string;
}

let celebrationId = 0;

const NAV_ITEMS: {
  id: ActiveView;
  label: string;
  icon: string;
  group: "work" | "app";
}[] = [
  { id: "overview", label: "Overview", icon: "▦", group: "work" },
  { id: "board", label: "ボード", icon: "▤", group: "work" },
  { id: "goals", label: "目標", icon: "◎", group: "work" },
  { id: "retro", label: "振り返り", icon: "↻", group: "work" },
  { id: "stats", label: "統計", icon: "▨", group: "work" },
  { id: "profile", label: "自分について", icon: "◉", group: "app" },
  { id: "settings", label: "設定", icon: "⚙", group: "app" },
];

const VIEW_LABEL: Record<ActiveView, string> = {
  overview: "Overview",
  board: "ボード",
  goals: "目標管理",
  retro: "振り返り",
  stats: "統計",
  profile: "自分について",
  settings: "設定",
};

const GITHUB_MARK = (
  <svg
    viewBox="0 0 16 16"
    width="20"
    height="20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

function renderNavIcon(
  item: { id: ActiveView; icon: string },
  github: GitHubStatus | null,
) {
  if (item.id === "profile") {
    if (github?.authOk && github.authUser) {
      return (
        <img
          className="sidebar-nav-avatar"
          src={`https://github.com/${github.authUser}.png?size=56`}
          alt=""
        />
      );
    }
    return GITHUB_MARK;
  }
  return item.icon;
}

export function App() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamText, setStreamText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [askRequests, setAskRequests] = useState<AskUserRequest[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("overview");
  const [tick, setTick] = useState(0);
  const [popupTaskId, setPopupTaskId] = useState<string | null>(null);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [theme, setThemeState] = useState<ThemeName>(() => getInitialTheme());
  const [chatOpen, setChatOpen] = useState(true);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubRepos, setGithubRepos] = useState<RepoInfo[]>([]);
  const [aiConfig, setAIConfig] = useState<AIToolConfig>({
    allowedTools: ["TodoWrite", "Bash"],
  });
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [activeRetro, setActiveRetro] = useState<Retrospective | null>(null);
  const [retroStreamText, setRetroStreamText] = useState("");
  const [retroWaiting, setRetroWaiting] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const showCelebration = useCallback((title: string, timeSpent: number) => {
    const id = ++celebrationId;
    const entry: Celebration = {
      id,
      title,
      duration: formatDuration(timeSpent),
    };
    setCelebrations((p) => [...p, entry]);
    setTimeout(() => {
      setCelebrations((p) => p.filter((c) => c.id !== id));
    }, 3500);
  }, []);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "thinking_delta":
        setThinkingText((p) => p + msg.text);
        break;
      case "stream_delta":
        setThinkingText("");
        setStreamText((p) => p + msg.text);
        break;
      case "tool_use": {
        const inputStr =
          typeof msg.input === "string"
            ? msg.input
            : JSON.stringify(msg.input ?? "");
        const hasGoalOp =
          inputStr.includes("GOAL_ADD:") ||
          inputStr.includes("GOAL_UPDATE:");
        const label =
          msg.name === "TodoWrite"
            ? hasGoalOp
              ? "ボード・目標を更新中"
              : "ボードを更新中"
            : msg.name === "AskUserQuestion"
              ? ""
              : `${msg.name} を実行中`;
        if (label) {
          setMessages((p) => [
            ...p,
            {
              id: nextId(),
              role: "tool",
              text: label,
              toolName: msg.name,
              toolInput: msg.input,
            },
          ]);
        }
        break;
      }
      case "session_cleared":
        setMessages([]);
        setStreamText("");
        setThinkingText("");
        setAskRequests([]);
        setWaiting(false);
        break;
      case "assistant":
        setStreamText("");
        setThinkingText("");
        setMessages((p) => [
          ...p,
          { id: nextId(), role: "assistant", text: msg.text },
        ]);
        break;
      case "ask_user":
        setThinkingText("");
        setAskRequests((p) => [
          ...p,
          { requestId: msg.requestId, questions: msg.questions },
        ]);
        break;
      case "kanban_sync":
        setTasks(msg.tasks);
        break;
      case "goal_sync":
        setGoals(msg.goals);
        break;
      case "profile_sync":
        setProfile(msg.profile);
        break;
      case "github_status":
        setGithubStatus(msg.status);
        break;
      case "github_repo_list":
        setGithubRepos(msg.repos);
        break;
      case "ai_config_sync":
        setAIConfig(msg.config);
        break;
      case "result":
        setStreamText("");
        setThinkingText("");
        setWaiting(false);
        setMessages((p) => [
          ...p,
          {
            id: nextId(),
            role: "system",
            text: `完了 — $${msg.cost.toFixed(4)} / ${msg.turns} turns`,
          },
        ]);
        break;
      case "retro_list_sync":
        setRetros(msg.retros);
        setActiveRetro((prev) => {
          if (!prev) return prev;
          const updated = msg.retros.find((r) => r.id === prev.id);
          if (!updated) {
            setRetroStreamText("");
            setRetroWaiting(false);
            return null;
          }
          return updated;
        });
        break;
      case "retro_sync":
        setRetros((prev) => {
          const exists = prev.some((r) => r.id === msg.retro.id);
          if (exists) {
            return prev.map((r) => (r.id === msg.retro.id ? msg.retro : r));
          }
          const doc = msg.retro.document;
          const hasContent = !!(
            doc.did.trim() ||
            doc.learned.trim() ||
            doc.next.trim() ||
            doc.dayRating ||
            msg.retro.aiComment.trim()
          );
          return hasContent ? [msg.retro, ...prev] : prev;
        });
        setActiveRetro(msg.retro);
        setRetroStreamText("");
        break;
      case "retro_doc_update":
        setRetros((prev) =>
          prev.map((r) =>
            r.id === msg.retroId ? { ...r, document: msg.document } : r,
          ),
        );
        setActiveRetro((prev) =>
          prev && prev.id === msg.retroId
            ? { ...prev, document: msg.document }
            : prev,
        );
        break;
      case "retro_stream_delta":
        setRetroStreamText((p) => p + msg.text);
        break;
      case "retro_assistant":
        setRetroStreamText("");
        setActiveRetro((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  { role: "assistant", text: msg.text },
                ],
              }
            : prev,
        );
        break;
      case "retro_completed":
        setRetros((prev) => {
          const exists = prev.some((r) => r.id === msg.retro.id);
          return exists
            ? prev.map((r) => (r.id === msg.retro.id ? msg.retro : r))
            : [msg.retro, ...prev];
        });
        setActiveRetro(msg.retro);
        setRetroStreamText("");
        setRetroWaiting(false);
        break;
      case "retro_session_waiting":
        setRetroWaiting(msg.waiting);
        break;
      case "retro_session_closed":
        setActiveRetro(null);
        setRetroStreamText("");
        setRetroWaiting(false);
        break;
      case "retro_error":
        setRetroWaiting(false);
        setRetroStreamText("");
        console.error("retro error:", msg.message);
        break;
      case "retro_thinking_delta":
        break;
    }
  }, []);

  const { send, connected } = useWebSocket(handleMessage);

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!connected) return;
      setMessages((p) => [...p, { id: nextId(), role: "user", text }]);
      send({ type: "message", message: text });
      setWaiting(true);
    },
    [connected, send],
  );

  const handleCancel = useCallback(() => {
    if (!connected) return;
    send({ type: "cancel" });
  }, [connected, send]);

  const handleClearSession = useCallback(() => {
    if (!connected) return;
    send({ type: "clear_session" });
    setMessages([]);
    setStreamText("");
    setThinkingText("");
    setAskRequests([]);
    setWaiting(false);
  }, [connected, send]);

  const handleRequestRepoList = useCallback(() => {
    send({ type: "github_list_repos" });
  }, [send]);

  const handleLinkRepo = useCallback(
    (args: { owner?: string; name: string; create: boolean; private: boolean }) => {
      send({ type: "github_link", ...args });
    },
    [send],
  );

  const handleUnlinkRepo = useCallback(() => {
    send({ type: "github_unlink" });
  }, [send]);

  const handleSyncNow = useCallback(() => {
    send({ type: "github_sync_now" });
  }, [send]);

  const handlePullNow = useCallback(() => {
    send({ type: "github_pull_now" });
  }, [send]);

  const handleToggleAutoSync = useCallback(
    (value: boolean) => {
      send({ type: "github_set_auto_sync", value });
    },
    [send],
  );

  const handleUpdateAIConfig = useCallback(
    (config: AIToolConfig) => {
      setAIConfig(config);
      send({ type: "ai_config_update", config });
    },
    [send],
  );

  const handleAskSubmit = useCallback(
    (requestId: string, answers: Record<string, string>) => {
      send({ type: "ask_response", requestId, answers });
      setAskRequests((p) => p.filter((r) => r.requestId !== requestId));
    },
    [send],
  );

  const handleTaskUpdate = useCallback(
    (task: KanbanTask) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      send({
        type: "kanban_edit",
        taskId: task.id,
        title: task.title,
        memo: task.memo,
        goalId: task.goalId,
        kpiId: task.kpiId,
        priority: task.priority,
        estimatedMinutes: task.estimatedMinutes,
      });
      setSelectedTask(task);
    },
    [send],
  );

  const stopTask = useCallback(
    (task: KanbanTask, now: string): KanbanTask => {
      const elapsed = Math.floor(
        (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000,
      );
      const log = { start: task.timerStartedAt, end: now, duration: elapsed };
      const stopped = {
        ...task,
        timeSpent: task.timeSpent + elapsed,
        timerStartedAt: "",
        timeLogs: [...task.timeLogs, log],
      };
      send({
        type: "kanban_edit",
        taskId: task.id,
        timeSpent: stopped.timeSpent,
        timerStartedAt: "",
        timeLogs: stopped.timeLogs,
      });
      return stopped;
    },
    [send],
  );

  const handleTimerToggle = useCallback(
    (taskId: string) => {
      setTasks((prev) => {
        const task = prev.find((t) => t.id === taskId);
        if (!task) return prev;
        const now = new Date().toISOString();

        if (task.timerStartedAt) {
          const stopped = stopTask(task, now);
          return prev.map((t) => (t.id === taskId ? stopped : t));
        } else {
          let next = prev;
          const running = prev.find(
            (t) => t.timerStartedAt && t.id !== taskId,
          );
          if (running) {
            const stopped = stopTask(running, now);
            next = next.map((t) => (t.id === running.id ? stopped : t));
          }
          const updated = {
            ...next.find((t) => t.id === taskId)!,
            timerStartedAt: now,
          };
          send({ type: "kanban_edit", taskId, timerStartedAt: now });
          setPopupTaskId(taskId);
          return next.map((t) => (t.id === taskId ? updated : t));
        }
      });
    },
    [send, stopTask],
  );

  const handleMoveColumn = useCallback(
    (taskId: string, column: string) => {
      setTasks((prev) => {
        const task = prev.find((t) => t.id === taskId);
        if (!task) return prev;
        const now = new Date().toISOString();
        let updated = { ...task, column: column as KanbanTask["column"] };
        if (task.timerStartedAt && column === "done") {
          const elapsed = Math.floor(
            (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000,
          );
          const log = {
            start: task.timerStartedAt,
            end: now,
            duration: elapsed,
          };
          updated = {
            ...updated,
            timeSpent: task.timeSpent + elapsed,
            timerStartedAt: "",
            timeLogs: [...task.timeLogs, log],
          };
        }
        if (column === "done" && !task.completedAt) {
          updated.completedAt = now;
        }
        if (column !== "done") {
          updated.completedAt = "";
        }
        send({
          type: "kanban_move",
          taskId,
          column,
          timeSpent: updated.timeSpent,
          timerStartedAt: updated.timerStartedAt,
          completedAt: updated.completedAt,
          timeLogs: updated.timeLogs,
        });

        if (column === "done") {
          showCelebration(updated.title, updated.timeSpent);
          setPopupTaskId(null);
        }

        return prev.map((t) => (t.id === taskId ? updated : t));
      });
    },
    [send, showCelebration],
  );

  const handleRetroStart = useCallback(
    (retroType: RetroType, anchorDate?: string, resumeDraftId?: string) => {
      send({ type: "retro_start", retroType, anchorDate, resumeDraftId });
      setRetroStreamText("");
    },
    [send],
  );

  const handleRetroSend = useCallback(
    (text: string) => {
      if (!activeRetro) return;
      setActiveRetro((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, { role: "user", text }],
            }
          : prev,
      );
      setRetroWaiting(true);
      setRetroStreamText("");
      send({ type: "retro_message", retroId: activeRetro.id, text });
    },
    [activeRetro, send],
  );

  const handleRetroComplete = useCallback(() => {
    if (!activeRetro) return;
    setRetroWaiting(true);
    setRetroStreamText("");
    send({ type: "retro_complete", retroId: activeRetro.id });
  }, [activeRetro, send]);

  const handleRetroCloseSession = useCallback(() => {
    setActiveRetro(null);
    setRetroStreamText("");
  }, []);

  const handleRetroOpen = useCallback((retro: Retrospective) => {
    setActiveRetro(retro);
    setRetroStreamText("");
  }, []);

  const handleRetroDiscardDraft = useCallback(
    (draftId: string) => {
      send({ type: "retro_discard_draft", draftId });
    },
    [send],
  );

  const handleRetroDelete = useCallback(
    (retroId: string) => {
      send({ type: "retro_delete", retroId });
    },
    [send],
  );

  const handleRetroEditField = useCallback(
    (
      retroId: string,
      key: "did" | "learned" | "next" | "aiComment",
      value: string,
    ) => {
      setRetros((prev) =>
        prev.map((r) => {
          if (r.id !== retroId) return r;
          if (key === "aiComment") return { ...r, aiComment: value };
          return { ...r, document: { ...r.document, [key]: value } };
        }),
      );
      setActiveRetro((prev) => {
        if (!prev || prev.id !== retroId) return prev;
        if (key === "aiComment") return { ...prev, aiComment: value };
        return { ...prev, document: { ...prev.document, [key]: value } };
      });
      if (key === "aiComment") {
        send({ type: "retro_edit_document", retroId, aiComment: value });
      } else {
        send({
          type: "retro_edit_document",
          retroId,
          document: { [key]: value },
        });
      }
    },
    [send],
  );

  const handleRetroEditDayRating = useCallback(
    (retroId: string, value: number) => {
      const clamped = Math.max(0, Math.min(10, Math.round(value)));
      setRetros((prev) =>
        prev.map((r) =>
          r.id === retroId
            ? { ...r, document: { ...r.document, dayRating: clamped } }
            : r,
        ),
      );
      setActiveRetro((prev) =>
        prev && prev.id === retroId
          ? { ...prev, document: { ...prev.document, dayRating: clamped } }
          : prev,
      );
      send({
        type: "retro_edit_document",
        retroId,
        document: { dayRating: clamped },
      });
    },
    [send],
  );

  const popupTask = useMemo(() => {
    if (!popupTaskId) return undefined;
    return tasks.find((t) => t.id === popupTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupTaskId, tasks, tick]);

  const popupGoalName = useMemo(() => {
    if (!popupTask?.goalId) return undefined;
    return goals.find((g) => g.id === popupTask.goalId)?.name;
  }, [popupTask, goals]);

  const isPopupRunning = !!popupTask?.timerStartedAt;

  const workNav = NAV_ITEMS.filter((n) => n.group === "work");
  const appNav = NAV_ITEMS.filter((n) => n.group === "app");

  const shellClass = [
    "app-shell",
    chatOpen ? "" : "app-shell--chat-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      {/* === Sidebar === */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">t</div>
        </div>

        <nav className="sidebar-nav sidebar-nav--top">
          {workNav.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${
                activeView === item.id ? "sidebar-nav-item--active" : ""
              }`}
              onClick={() => setActiveView(item.id)}
              title={item.label}
            >
              <span className="sidebar-nav-icon">
                {renderNavIcon(item, githubStatus)}
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <nav className="sidebar-nav sidebar-nav--bottom">
          {appNav.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${
                activeView === item.id ? "sidebar-nav-item--active" : ""
              }`}
              onClick={() => setActiveView(item.id)}
              title={item.label}
            >
              <span className="sidebar-nav-icon">
                {renderNavIcon(item, githubStatus)}
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
          {githubStatus?.authOk && githubStatus?.linked && (
            <GitHubSyncTab
              status={githubStatus}
              tick={tick}
              onSyncNow={handleSyncNow}
              onPullNow={handlePullNow}
            />
          )}
        </nav>
      </aside>

      {/* === Topbar === */}
      <header className="topbar">
        <div className="topbar-crumbs">
          <span className="topbar-crumb">todome</span>
          <span className="topbar-crumb-sep">›</span>
          <span className="topbar-crumb-current">{VIEW_LABEL[activeView]}</span>
        </div>
        <div className="topbar-status">
          <span
            className={`topbar-status-dot ${
              connected ? "topbar-status-dot--online" : "topbar-status-dot--offline"
            }`}
          />
          {connected ? "connected" : "connecting…"}
        </div>
        {!chatOpen && (
          <button
            className="topbar-toggle topbar-toggle--right"
            onClick={() => setChatOpen(true)}
            title="AIアシスタントを開く"
            aria-label="AIアシスタントを開く"
          >
            &#10038;
          </button>
        )}
      </header>

      {/* === Main === */}
      <main className="main">
        {activeView === "overview" ? (
          <OverviewPanel
            tasks={tasks}
            goals={goals}
            tick={tick}
            onOpenBoard={() => setActiveView("board")}
            onCardClick={setSelectedTask}
          />
        ) : activeView === "board" ? (
          <KanbanBoard
            tasks={tasks}
            goals={goals}
            setTasks={setTasks}
            send={send}
            onCardClick={setSelectedTask}
            onTimerToggle={handleTimerToggle}
            onMoveColumn={handleMoveColumn}
            tick={tick}
          />
        ) : activeView === "goals" ? (
          <GoalPanel
            goals={goals}
            setGoals={setGoals}
            send={send}
            githubRepos={githubRepos}
            onRequestRepoList={handleRequestRepoList}
            githubAuthOk={!!githubStatus?.authOk}
          />
        ) : activeView === "retro" ? (
          <RetroPanel
            retros={retros}
            activeRetro={activeRetro}
            tasks={tasks}
            streamText={retroStreamText}
            waiting={retroWaiting}
            onStart={handleRetroStart}
            onSend={handleRetroSend}
            onComplete={handleRetroComplete}
            onCloseSession={handleRetroCloseSession}
            onOpenRetro={handleRetroOpen}
            onDiscardDraft={handleRetroDiscardDraft}
            onDelete={handleRetroDelete}
            onEditField={handleRetroEditField}
            onEditDayRating={handleRetroEditDayRating}
          />
        ) : activeView === "stats" ? (
          <StatsPanel tasks={tasks} goals={goals} tick={tick} />
        ) : activeView === "profile" ? (
          <ProfilePanel profile={profile} setProfile={setProfile} send={send} />
        ) : (
          <SettingsPanel
            theme={theme}
            setTheme={setThemeState}
            githubStatus={githubStatus}
            githubRepos={githubRepos}
            onRequestRepoList={handleRequestRepoList}
            onLinkRepo={handleLinkRepo}
            onUnlink={handleUnlinkRepo}
            onSyncNow={handleSyncNow}
            onPullNow={handlePullNow}
            onToggleAutoSync={handleToggleAutoSync}
            aiConfig={aiConfig}
            onUpdateAIConfig={handleUpdateAIConfig}
          />
        )}
      </main>

      {/* === AI Assistant === */}
      <ChatPanel
        messages={messages}
        streamText={streamText}
        thinkingText={thinkingText}
        askRequests={askRequests}
        waiting={waiting}
        connected={connected}
        onSend={handleSendMessage}
        onAskSubmit={handleAskSubmit}
        onCancel={handleCancel}
        onClearSession={handleClearSession}
        onClose={() => setChatOpen(false)}
      />

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          goals={goals}
          onSave={handleTaskUpdate}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {popupTask && (
        <div
          className={`timer-popup ${isPopupRunning ? "" : "timer-popup--paused"}`}
        >
          <div
            className={`timer-popup-pulse ${
              isPopupRunning ? "" : "timer-popup-pulse--paused"
            }`}
          />
          <div className="timer-popup-body">
            <div className="timer-popup-title">{popupTask.title}</div>
            <div className="timer-popup-meta">
              {popupGoalName && (
                <span className="timer-popup-goal">{popupGoalName}</span>
              )}
              {!isPopupRunning && (
                <span className="timer-popup-status-badge">一時停止中</span>
              )}
            </div>
          </div>
          <div className="timer-popup-time">
            {formatDuration(totalSeconds(popupTask))}
            {popupTask.estimatedMinutes > 0 && (
              <span className="timer-popup-estimate">
                /{formatDuration(popupTask.estimatedMinutes * 60)}
              </span>
            )}
          </div>
          <div className="timer-popup-actions">
            {isPopupRunning ? (
              <button
                className="timer-popup-btn timer-popup-btn--pause"
                onClick={() => handleTimerToggle(popupTask.id)}
                title="一時停止"
              >
                &#10074;&#10074; 一時停止
              </button>
            ) : (
              <button
                className="timer-popup-btn timer-popup-btn--resume"
                onClick={() => handleTimerToggle(popupTask.id)}
                title="再開"
              >
                &#9654; 再開
              </button>
            )}
            <button
              className="timer-popup-btn timer-popup-btn--done"
              onClick={() => handleMoveColumn(popupTask.id, "done")}
              title="完了"
            >
              &#10003; 完了
            </button>
            <button
              className="timer-popup-close"
              onClick={() => setPopupTaskId(null)}
              title="閉じる"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {celebrations.map((c) => (
        <div key={c.id} className="celebration-toast">
          <div className="celebration-check">&#10003;</div>
          <div className="celebration-body">
            <div className="celebration-praise">
              {PRAISE_MESSAGES[c.id % PRAISE_MESSAGES.length]}
            </div>
            <div className="celebration-title">{c.title}</div>
            <div className="celebration-duration">{c.duration}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
