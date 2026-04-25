import { registerHandler } from "../dispatch.ts";
import { aiConfigUpdate } from "./aiConfig.ts";
import { appConfigUpdate } from "./appConfig.ts";
import {
  caldavConnect,
  caldavDisconnect,
  caldavListCalendars,
  caldavStatusRequest,
} from "./caldav.ts";
import {
  githubCommitDiff,
  githubLink,
  githubListCommits,
  githubListRepos,
  githubPullNow,
  githubRestoreCommit,
  githubSetAutoSync,
  githubStatusRequest,
  githubSyncNow,
  githubUnlink,
} from "./github.ts";
import { goalAdd, goalDelete, goalEdit } from "./goal.ts";
import { message } from "./message.ts";
import {
  kanbanAdd,
  kanbanDelete,
  kanbanEdit,
  kanbanMove,
  kanbanReorder,
} from "./kanban.ts";
import {
  lifeActivityArchive,
  lifeActivityDelete,
  lifeActivityReorder,
  lifeActivityUpsert,
  lifeLogDelete,
  lifeLogRangeRequest,
  lifeLogStart,
  lifeLogStop,
} from "./life.ts";
import { clearSession, profileUpdate } from "./profile.ts";
import {
  quotaDelete,
  quotaLogRangeRequest,
  quotaLogStart,
  quotaLogStop,
  quotaReorder,
  quotaUpsert,
} from "./quota.ts";
import {
  retroCloseSession,
  retroComplete,
  retroEditDocument,
  retroMessage,
  retroReopen,
  retroStart,
} from "./retro.ts";
import { retroDelete, retroDiscardDraft, retroList } from "./retroList.ts";
import { scheduleAdd, scheduleDelete, scheduleEdit } from "./schedule.ts";
import {
  subscriptionAdd,
  subscriptionDelete,
  subscriptionEdit,
  subscriptionRefresh,
} from "./subscription.ts";

export function registerAllHandlers(): void {
  registerHandler("kanban_move", kanbanMove);
  registerHandler("kanban_add", kanbanAdd);
  registerHandler("kanban_delete", kanbanDelete);
  registerHandler("kanban_reorder", kanbanReorder);
  registerHandler("kanban_edit", kanbanEdit);
  registerHandler("goal_add", goalAdd);
  registerHandler("goal_edit", goalEdit);
  registerHandler("goal_delete", goalDelete);
  registerHandler("profile_update", profileUpdate);
  registerHandler("clear_session", clearSession);
  registerHandler("ai_config_update", aiConfigUpdate);
  registerHandler("app_config_update", appConfigUpdate);
  registerHandler("life_activity_upsert", lifeActivityUpsert);
  registerHandler("life_activity_archive", lifeActivityArchive);
  registerHandler("life_activity_delete", lifeActivityDelete);
  registerHandler("life_activity_reorder", lifeActivityReorder);
  registerHandler("life_log_start", lifeLogStart);
  registerHandler("life_log_stop", lifeLogStop);
  registerHandler("life_log_delete", lifeLogDelete);
  registerHandler("life_log_range_request", lifeLogRangeRequest);
  registerHandler("quota_upsert", quotaUpsert);
  registerHandler("quota_delete", quotaDelete);
  registerHandler("quota_reorder", quotaReorder);
  registerHandler("quota_log_start", quotaLogStart);
  registerHandler("quota_log_stop", quotaLogStop);
  registerHandler("quota_log_range_request", quotaLogRangeRequest);
  registerHandler("retro_list", retroList);
  registerHandler("retro_discard_draft", retroDiscardDraft);
  registerHandler("retro_delete", retroDelete);
  registerHandler("retro_start", retroStart);
  registerHandler("retro_message", retroMessage);
  registerHandler("retro_complete", retroComplete);
  registerHandler("retro_reopen", retroReopen);
  registerHandler("retro_edit_document", retroEditDocument);
  registerHandler("retro_close_session", retroCloseSession);
  registerHandler("github_status_request", githubStatusRequest);
  registerHandler("github_list_repos", githubListRepos);
  registerHandler("github_link", githubLink);
  registerHandler("github_unlink", githubUnlink);
  registerHandler("github_sync_now", githubSyncNow);
  registerHandler("github_pull_now", githubPullNow);
  registerHandler("github_set_auto_sync", githubSetAutoSync);
  registerHandler("github_list_commits", githubListCommits);
  registerHandler("github_commit_diff", githubCommitDiff);
  registerHandler("github_restore_commit", githubRestoreCommit);
  registerHandler("schedule_add", scheduleAdd);
  registerHandler("schedule_edit", scheduleEdit);
  registerHandler("schedule_delete", scheduleDelete);
  registerHandler("subscription_add", subscriptionAdd);
  registerHandler("subscription_edit", subscriptionEdit);
  registerHandler("subscription_delete", subscriptionDelete);
  registerHandler("subscription_refresh", subscriptionRefresh);
  registerHandler("caldav_status_request", caldavStatusRequest);
  registerHandler("caldav_connect", caldavConnect);
  registerHandler("caldav_disconnect", caldavDisconnect);
  registerHandler("caldav_list_calendars", caldavListCalendars);
  registerHandler("message", message);
}
