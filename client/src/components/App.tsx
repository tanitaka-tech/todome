import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AskUserRequest,
  ChatMessage,
  Goal,
  KanbanTask,
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

let msgId = 0;
const nextId = () => String(++msgId);

const TOOL_PREFIX = "\x00tool:";

type ActiveView =
  | "overview"
  | "board"
  | "goals"
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
  { id: "stats", label: "統計", icon: "▨", group: "work" },
  { id: "profile", label: "自分について", icon: "◉", group: "work" },
  { id: "settings", label: "設定", icon: "⚙", group: "app" },
];

const VIEW_LABEL: Record<ActiveView, string> = {
  overview: "Overview",
  board: "ボード",
  goals: "目標管理",
  stats: "統計",
  profile: "自分について",
  settings: "設定",
};

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
        const hasGoalOp =
          msg.input?.includes("GOAL_ADD:") ||
          msg.input?.includes("GOAL_UPDATE:");
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
            { id: nextId(), role: "system", text: TOOL_PREFIX + label },
          ]);
        }
        break;
      }
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
        if (task.timerStartedAt) {
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

  return (
    <div className="app-shell">
      {/* === Sidebar === */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">t</div>
          <div>
            <div className="sidebar-brand-text">todome</div>
            <div className="sidebar-brand-sub">TASK · AI</div>
          </div>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <nav className="sidebar-nav">
          {workNav.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${
                activeView === item.id ? "sidebar-nav-item--active" : ""
              }`}
              onClick={() => setActiveView(item.id)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label">App</div>
        <nav className="sidebar-nav">
          {appNav.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${
                activeView === item.id ? "sidebar-nav-item--active" : ""
              }`}
              onClick={() => setActiveView(item.id)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>v0.1</span>
          <span style={{ marginLeft: "auto" }}>
            {theme === "dark" ? "DARK" : "BEIGE"}
          </span>
        </div>
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
          <GoalPanel goals={goals} setGoals={setGoals} send={send} />
        ) : activeView === "stats" ? (
          <StatsPanel tasks={tasks} goals={goals} tick={tick} />
        ) : activeView === "profile" ? (
          <ProfilePanel profile={profile} setProfile={setProfile} send={send} />
        ) : (
          <SettingsPanel theme={theme} setTheme={setThemeState} />
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
