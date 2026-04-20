import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import type {
  AIToolConfig,
  AskUserRequest,
  ChatMessage,
  CommitDiffEntry,
  GitCommit,
  GitHubStatus,
  Goal,
  KanbanTask,
  LifeActivity,
  LifeLog,
  RepoInfo,
  Retrospective,
  RetroType,
  UserProfile,
  WSMessage,
} from "../types";
import { formatDuration, isLifeLogActive, totalSeconds } from "../types";
import { applyTheme, getInitialTheme, type ThemeName } from "../theme";
import {
  applyLanguage,
  getInitialLanguage,
  type Language,
} from "../i18n/language";
import {
  loadBoardGoalFilter,
  loadBoardRecentDays,
  loadPopupTaskId,
  loadRetroTab,
  loadRetroViewMode,
  saveBoardGoalFilter,
  saveBoardRecentDays,
  savePopupTaskId,
  saveRetroTab,
  saveRetroViewMode,
} from "../viewState";
import { useWebSocket } from "../hooks/useWebSocket";
import { KanbanBoard } from "./KanbanBoard";
import { ChatPanel } from "./ChatPanel";
import { TaskDetailModal } from "./TaskDetailModal";
import { GoalPanel } from "./GoalPanel";
import { ProfilePanel } from "./ProfilePanel";
import { StatsPanel } from "./StatsPanel";
import { OverviewPanel } from "./OverviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { RetroPanel, type RetroViewMode } from "./RetroPanel";
import { GitHubSyncTab } from "./GitHubSyncTab";
import { ShortcutsHelpModal } from "./ShortcutsHelpModal";
import { LifeLogTimer } from "./LifeLogTimer";

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
  icon: string;
  group: "work" | "app";
}[] = [
  { id: "overview", icon: "⌂", group: "work" },
  { id: "board", icon: "⫴", group: "work" },
  { id: "goals", icon: "⌖", group: "work" },
  { id: "retro", icon: "↻", group: "work" },
  { id: "stats", icon: "〽", group: "work" },
  { id: "profile", icon: "◉", group: "app" },
  { id: "settings", icon: "⚙", group: "app" },
];

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
  const { t: tNav } = useTranslation("nav");
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
  const [popupTaskId, setPopupTaskIdState] = useState<string | null>(() =>
    loadPopupTaskId(),
  );
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [theme, setThemeState] = useState<ThemeName>(() => getInitialTheme());
  const [language, setLanguageState] = useState<Language>(() =>
    getInitialLanguage(),
  );
  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    applyLanguage(lang);
  }, []);
  const [chatOpen, setChatOpen] = useState(true);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubRepos, setGithubRepos] = useState<RepoInfo[]>([]);
  const [githubCommits, setGithubCommits] = useState<GitCommit[]>([]);
  const [commitDiffs, setCommitDiffs] = useState<Record<string, CommitDiffEntry>>(
    {},
  );
  const [aiConfig, setAIConfig] = useState<AIToolConfig>({
    allowedTools: ["TodoWrite", "Bash"],
    allowGhApi: false,
    model: "claude-sonnet-4-6",
    thinkingEffort: "high",
  });
  const [lifeActivities, setLifeActivities] = useState<LifeActivity[]>([]);
  const [lifeLogs, setLifeLogs] = useState<LifeLog[]>([]);
  const [lifeLogPopupDismissedId, setLifeLogPopupDismissedId] = useState<
    string | null
  >(null);
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [activeRetro, setActiveRetro] = useState<Retrospective | null>(null);
  const [retroStreamText, setRetroStreamText] = useState("");
  const [retroWaiting, setRetroWaiting] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [boardGoalFilter, setBoardGoalFilterState] = useState<string>(() =>
    loadBoardGoalFilter(),
  );
  const [boardRecentDays, setBoardRecentDaysState] = useState<number>(() =>
    loadBoardRecentDays(),
  );
  const [retroTab, setRetroTabState] = useState<RetroType>(() => loadRetroTab());
  const [retroViewMode, setRetroViewModeState] = useState<RetroViewMode>(() =>
    loadRetroViewMode(),
  );

  const setBoardGoalFilter = useCallback((value: string) => {
    setBoardGoalFilterState(value);
    saveBoardGoalFilter(value);
  }, []);
  const setBoardRecentDays = useCallback((value: number) => {
    setBoardRecentDaysState(value);
    saveBoardRecentDays(value);
  }, []);
  const setRetroTab = useCallback((value: RetroType) => {
    setRetroTabState(value);
    saveRetroTab(value);
  }, []);
  const setRetroViewMode = useCallback((value: RetroViewMode) => {
    setRetroViewModeState(value);
    saveRetroViewMode(value);
  }, []);
  const setPopupTaskId = useCallback((value: string | null) => {
    setPopupTaskIdState(value);
    savePopupTaskId(value);
  }, []);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const gChordRef = useRef<number | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

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
              ? i18n.t("nav:toolUseTodoWriteGoal")
              : i18n.t("nav:toolUseTodoWrite")
            : msg.name === "AskUserQuestion"
              ? ""
              : i18n.t("nav:toolUseGeneric", { name: msg.name });
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
      case "github_commit_list":
        setGithubCommits(msg.commits);
        setCommitDiffs({});
        break;
      case "github_commit_diff_result":
        setCommitDiffs((p) => ({
          ...p,
          [msg.hash]: {
            summary: msg.summary,
            details: msg.details,
            error: msg.error,
          },
        }));
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
            text: i18n.t("nav:resultMessage", {
              cost: msg.cost.toFixed(4),
              turns: msg.turns,
            }),
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
      case "life_activity_sync":
        setLifeActivities(msg.activities);
        break;
      case "life_log_sync":
        setLifeLogs(msg.logs);
        break;
      case "life_log_started":
      case "life_log_stopped":
        break;
    }
  }, []);

  const { send, connected } = useWebSocket(handleMessage);

  // 切断直後のフラッシュを避けるため、1.5 秒続いた切断状態のみバナー表示する。
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  useEffect(() => {
    const id = setTimeout(
      () => setShowOfflineBanner(!connected),
      connected ? 0 : 1500,
    );
    return () => clearTimeout(id);
  }, [connected]);

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

  const handleListCommits = useCallback(() => {
    send({ type: "github_list_commits" });
  }, [send]);

  const handleRequestCommitDiff = useCallback(
    (hash: string) => {
      send({ type: "github_commit_diff", hash });
    },
    [send],
  );

  const handleRestoreCommit = useCallback(
    (hash: string) => {
      send({ type: "github_restore_commit", hash });
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

  const handleModelChange = useCallback(
    (model: AIToolConfig["model"]) => {
      handleUpdateAIConfig({ ...aiConfig, model });
    },
    [aiConfig, handleUpdateAIConfig],
  );

  const handleThinkingEffortChange = useCallback(
    (thinkingEffort: AIToolConfig["thinkingEffort"]) => {
      handleUpdateAIConfig({ ...aiConfig, thinkingEffort });
    },
    [aiConfig, handleUpdateAIConfig],
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
          const current = next.find((t) => t.id === taskId)!;
          const shouldMove = current.column !== "in_progress";
          const updated: KanbanTask = {
            ...current,
            timerStartedAt: now,
            ...(shouldMove
              ? { column: "in_progress" as KanbanTask["column"], completedAt: "" }
              : {}),
          };
          if (shouldMove) {
            send({
              type: "kanban_move",
              taskId,
              column: "in_progress",
              timeSpent: updated.timeSpent,
              timerStartedAt: now,
              completedAt: "",
              timeLogs: updated.timeLogs,
            });
          } else {
            send({ type: "kanban_edit", taskId, timerStartedAt: now });
          }
          setPopupTaskId(taskId);
          return next.map((t) => (t.id === taskId ? updated : t));
        }
      });
    },
    [send, stopTask, setPopupTaskId],
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
    [send, showCelebration, setPopupTaskId],
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

  const handleRetroReopen = useCallback(() => {
    if (!activeRetro || !activeRetro.completedAt) return;
    setRetroWaiting(true);
    setRetroStreamText("");
    send({ type: "retro_reopen", retroId: activeRetro.id });
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

  const handleRetroEditSleep = useCallback(
    (
      retroId: string,
      key: "wakeUpTime" | "bedtime",
      value: string,
    ) => {
      setRetros((prev) =>
        prev.map((r) =>
          r.id === retroId
            ? { ...r, document: { ...r.document, [key]: value } }
            : r,
        ),
      );
      setActiveRetro((prev) =>
        prev && prev.id === retroId
          ? { ...prev, document: { ...prev.document, [key]: value } }
          : prev,
      );
      send({
        type: "retro_edit_document",
        retroId,
        document: { [key]: value },
      });
    },
    [send],
  );

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const armGChord = () => {
      if (gChordRef.current !== null) window.clearTimeout(gChordRef.current);
      gChordRef.current = window.setTimeout(() => {
        gChordRef.current = null;
      }, 1500);
    };
    const consumeGChord = (): boolean => {
      if (gChordRef.current === null) return false;
      window.clearTimeout(gChordRef.current);
      gChordRef.current = null;
      return true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);

      if (e.key === "Escape") {
        if (showShortcutsHelp) {
          e.preventDefault();
          setShowShortcutsHelp(false);
          return;
        }
        if (selectedTask) {
          e.preventDefault();
          setSelectedTask(null);
          return;
        }
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setChatOpen((p) => !p);
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (connected) {
          e.preventDefault();
          handleClearSession();
        }
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && e.key === ".") {
        if (waiting && connected) {
          e.preventDefault();
          handleCancel();
        }
        return;
      }

      if (typing) return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcutsHelp((p) => !p);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => chatInputRef.current?.focus(), 0);
        return;
      }

      if (consumeGChord()) {
        const k = e.key.toLowerCase();
        const map: Record<string, ActiveView> = {
          o: "overview",
          b: "board",
          g: "goals",
          r: "retro",
          s: "stats",
          p: "profile",
        };
        if (map[k]) {
          e.preventDefault();
          setActiveView(map[k]);
          return;
        }
        if (e.key === ",") {
          e.preventDefault();
          setActiveView("settings");
          return;
        }
        return;
      }

      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        armGChord();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (gChordRef.current !== null) {
        window.clearTimeout(gChordRef.current);
        gChordRef.current = null;
      }
    };
  }, [
    showShortcutsHelp,
    selectedTask,
    connected,
    waiting,
    handleCancel,
    handleClearSession,
  ]);

  const popupTask = useMemo(() => {
    if (!popupTaskId) return undefined;
    const found = tasks.find((t) => t.id === popupTaskId);
    if (!found || found.column === "done") return undefined;
    return found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupTaskId, tasks, tick]);

  const activeLifeLog = useMemo(
    () => lifeLogs.find((l) => isLifeLogActive(l)) ?? null,
    [lifeLogs],
  );
  const activeLifeActivity = useMemo(
    () =>
      activeLifeLog
        ? (lifeActivities.find((a) => a.id === activeLifeLog.activityId) ??
          null)
        : null,
    [activeLifeLog, lifeActivities],
  );
  const showLifeLogPopup =
    !!activeLifeLog &&
    !!activeLifeActivity &&
    activeLifeLog.id !== lifeLogPopupDismissedId;

  const handleLifeLogStop = useCallback(() => {
    if (!activeLifeLog) return;
    send({ type: "life_log_stop", log_id: activeLifeLog.id });
  }, [activeLifeLog, send]);

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
          <a
            className="sidebar-brand-mark"
            href="https://github.com/tanitaka-tech/todome"
            target="_blank"
            rel="noopener noreferrer"
            title={tNav("openGithubRepo")}
          >
            t
          </a>
        </div>

        <nav className="sidebar-nav sidebar-nav--top">
          {workNav.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${
                activeView === item.id ? "sidebar-nav-item--active" : ""
              }`}
              onClick={() => setActiveView(item.id)}
              title={tNav(item.id)}
            >
              <span className="sidebar-nav-icon">
                {renderNavIcon(item, githubStatus)}
              </span>
              <span className="sidebar-nav-label">{tNav(item.id)}</span>
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
              title={tNav(item.id)}
            >
              <span className="sidebar-nav-icon">
                {renderNavIcon(item, githubStatus)}
              </span>
              <span className="sidebar-nav-label">{tNav(item.id)}</span>
            </button>
          ))}
          {githubStatus?.authOk && githubStatus?.linked && (
            <GitHubSyncTab
              status={githubStatus}
              tick={tick}
              commits={githubCommits}
              commitDiffs={commitDiffs}
              onSyncNow={handleSyncNow}
              onPullNow={handlePullNow}
              onListCommits={handleListCommits}
              onRequestCommitDiff={handleRequestCommitDiff}
              onRestoreCommit={handleRestoreCommit}
            />
          )}
        </nav>
      </aside>

      {showOfflineBanner && (
        <div className="offline-banner" role="alert">
          <span className="offline-banner-dot" />
          <div className="offline-banner-text">
            <strong>{tNav("offlineBanner")}</strong>
            <span>{tNav("offlineBannerHint")}</span>
          </div>
        </div>
      )}

      {/* === Topbar === */}
      <header className="topbar">
        <div className="topbar-crumbs">
          <span className="topbar-crumb">todome</span>
          <span className="topbar-crumb-sep">›</span>
          <span className="topbar-crumb-current">
            {tNav(`view_${activeView}`)}
          </span>
        </div>
        <div className="topbar-status">
          <span
            className={`topbar-status-dot ${
              connected ? "topbar-status-dot--online" : "topbar-status-dot--offline"
            }`}
          />
          {connected ? tNav("connected") : tNav("connecting")}
        </div>
        {!chatOpen && (
          <button
            className="topbar-toggle topbar-toggle--right"
            onClick={() => setChatOpen(true)}
            title={tNav("openAiAssistant")}
            aria-label={tNav("openAiAssistant")}
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
            goalFilter={boardGoalFilter}
            setGoalFilter={setBoardGoalFilter}
            recentDays={boardRecentDays}
            setRecentDays={setBoardRecentDays}
            lifeActivities={lifeActivities}
            lifeLogs={lifeLogs}
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
            tab={retroTab}
            setTab={setRetroTab}
            viewMode={retroViewMode}
            setViewMode={setRetroViewMode}
            onStart={handleRetroStart}
            onSend={handleRetroSend}
            onComplete={handleRetroComplete}
            onReopen={handleRetroReopen}
            onCloseSession={handleRetroCloseSession}
            onOpenRetro={handleRetroOpen}
            onDiscardDraft={handleRetroDiscardDraft}
            onDelete={handleRetroDelete}
            onEditField={handleRetroEditField}
            onEditDayRating={handleRetroEditDayRating}
            onEditSleep={handleRetroEditSleep}
          />
        ) : activeView === "stats" ? (
          <StatsPanel tasks={tasks} goals={goals} tick={tick} />
        ) : activeView === "profile" ? (
          <ProfilePanel profile={profile} setProfile={setProfile} send={send} />
        ) : (
          <SettingsPanel
            theme={theme}
            setTheme={setThemeState}
            language={language}
            setLanguage={setLanguage}
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
        model={aiConfig.model}
        onModelChange={handleModelChange}
        thinkingEffort={aiConfig.thinkingEffort}
        onThinkingEffortChange={handleThinkingEffortChange}
        onSend={handleSendMessage}
        onAskSubmit={handleAskSubmit}
        onCancel={handleCancel}
        onClearSession={handleClearSession}
        onClose={() => setChatOpen(false)}
        inputRef={chatInputRef}
      />

      {showShortcutsHelp && (
        <ShortcutsHelpModal onClose={() => setShowShortcutsHelp(false)} />
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          goals={goals}
          onSave={handleTaskUpdate}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {popupTask && !showLifeLogPopup && (
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
                <span className="timer-popup-status-badge">
                  {tNav("timerPaused")}
                </span>
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
                title={tNav("timerPause")}
              >
                &#10074;&#10074; {tNav("timerPause")}
              </button>
            ) : (
              <button
                className="timer-popup-btn timer-popup-btn--resume"
                onClick={() => handleTimerToggle(popupTask.id)}
                title={tNav("timerResume")}
              >
                &#9654; {tNav("timerResume")}
              </button>
            )}
            <button
              className="timer-popup-btn timer-popup-btn--done"
              onClick={() => handleMoveColumn(popupTask.id, "done")}
              title={tNav("timerDone")}
            >
              &#10003; {tNav("timerDone")}
            </button>
            <button
              className="timer-popup-close"
              onClick={() => setPopupTaskId(null)}
              title={tNav("timerClose")}
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {showLifeLogPopup && activeLifeLog && activeLifeActivity && (
        <LifeLogTimer
          activity={activeLifeActivity}
          log={activeLifeLog}
          tick={tick}
          onStop={handleLifeLogStop}
          onClose={() => setLifeLogPopupDismissedId(activeLifeLog.id)}
        />
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
