// config.ts は読み込み時点で DATA_DIR を固定するため、server コードを import する前に
// テスト用ディレクトリを環境変数で指すようにする。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "todome-retrolist-handler-test-"));
process.env.TODOME_DATA_DIR = TEST_DATA_DIR;

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDb, resetDbCache } from "../../db.ts";
import {
  activeSockets,
  createSessionState,
  type AppWebSocket,
  type SessionState,
} from "../../state.ts";
import { loadRetros, saveRetro } from "../../storage/retro.ts";
import type { Retrospective } from "../../types.ts";
import { retroDelete, retroDiscardDraft, retroList } from "./retroList.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function attachFakeBroadcastSocket(): SentMessage[] {
  const sent: SentMessage[] = [];
  const fake = {
    data: { id: "broadcast", session: createSessionState() },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  activeSockets.add(fake);
  return sent;
}

function makeRequester(): {
  ws: AppWebSocket;
  session: SessionState;
  inbox: SentMessage[];
} {
  const session = createSessionState();
  const inbox: SentMessage[] = [];
  const ws = {
    data: { id: "requester", session },
    send(payload: string) {
      inbox.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws, session, inbox };
}

function makeRetro(overrides: Partial<Retrospective> = {}): Retrospective {
  const now = "2025-01-01T00:00:00.000Z";
  return {
    id: overrides.id ?? "r1",
    type: "daily",
    periodStart: "2025-01-01",
    periodEnd: "2025-01-01",
    document: {
      did: "",
      learned: "",
      next: "",
      dayRating: 3,
      wakeUpTime: "",
      bedtime: "",
    },
    messages: [],
    aiComment: "",
    completedAt: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("retroList handlers", () => {
  let broadcastSent: SentMessage[];

  beforeEach(() => {
    activeSockets.clear();
    // 各テストで DB を空に戻す
    getDb().exec("DELETE FROM retrospectives");
    broadcastSent = attachFakeBroadcastSocket();
  });

  afterEach(() => {
    activeSockets.clear();
    getDb().exec("DELETE FROM retrospectives");
  });

  afterAll(() => {
    resetDbCache();
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe("retroList", () => {
    it("DB に保存された retro を要求元の WS にだけ retro_list_sync で返す", async () => {
      saveRetro(makeRetro({ id: "r1" }));
      saveRetro(makeRetro({ id: "r2", periodStart: "2025-01-02", periodEnd: "2025-01-02" }));
      const { ws, session, inbox } = makeRequester();

      await retroList(ws, session, {});

      expect(inbox).toHaveLength(1);
      const msg = inbox[0]!;
      expect(msg).toMatchObject({ type: "retro_list_sync" });
      const retros = msg.retros as Retrospective[];
      expect(retros.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
      // broadcast 経由では他のソケットに飛ばないこと
      expect(broadcastSent).toHaveLength(0);
    });
  });

  describe("retroDiscardDraft", () => {
    it("対象 draftId の retro と pendingRetros エントリを削除し、無関係な retro は残す", async () => {
      saveRetro(makeRetro({ id: "draft" }));
      saveRetro(makeRetro({ id: "keep" }));
      const { ws, session, inbox } = makeRequester();
      session.pendingRetros.set("draft", makeRetro({ id: "draft" }));
      session.pendingRetros.set("keep", makeRetro({ id: "keep" }));

      await retroDiscardDraft(ws, session, { draftId: "draft" });

      const remaining = loadRetros().map((r) => r.id);
      expect(remaining).toEqual(["keep"]);
      expect(session.pendingRetros.has("draft")).toBe(false);
      expect(session.pendingRetros.has("keep")).toBe(true);

      // 要求元には最新の retro_list_sync が返る、broadcast はしない
      expect(inbox).toHaveLength(1);
      const msg = inbox[0]!;
      expect(msg).toMatchObject({ type: "retro_list_sync" });
      expect((msg.retros as Retrospective[]).map((r) => r.id)).toEqual(["keep"]);
      expect(broadcastSent).toHaveLength(0);
    });

    it("draftId が空文字なら DB / pendingRetros を変更せず、現状の retro_list_sync を返すだけ", async () => {
      saveRetro(makeRetro({ id: "keep" }));
      const { ws, session, inbox } = makeRequester();
      session.pendingRetros.set("keep", makeRetro({ id: "keep" }));

      await retroDiscardDraft(ws, session, {});

      expect(loadRetros().map((r) => r.id)).toEqual(["keep"]);
      expect(session.pendingRetros.has("keep")).toBe(true);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!).toMatchObject({ type: "retro_list_sync" });
    });
  });

  describe("retroDelete", () => {
    it("対象 retroId の retro / pendingRetros を削除し、結果を全 WS に broadcast する", async () => {
      saveRetro(makeRetro({ id: "gone" }));
      saveRetro(makeRetro({ id: "keep" }));
      const { ws, session, inbox } = makeRequester();
      session.pendingRetros.set("gone", makeRetro({ id: "gone" }));
      session.pendingRetros.set("keep", makeRetro({ id: "keep" }));

      await retroDelete(ws, session, { retroId: "gone" });

      const remaining = loadRetros().map((r) => r.id);
      expect(remaining).toEqual(["keep"]);
      expect(session.pendingRetros.has("gone")).toBe(false);
      expect(session.pendingRetros.has("keep")).toBe(true);

      // broadcast 経由で接続中ソケットに届く（要求元 ws.send は使わない）
      expect(inbox).toHaveLength(0);
      const syncs = broadcastSent.filter((m) => m.type === "retro_list_sync");
      expect(syncs).toHaveLength(1);
      expect((syncs[0]!.retros as Retrospective[]).map((r) => r.id)).toEqual(["keep"]);
    });

    it("retroId が空文字なら DB は変更せず、現状リストだけ broadcast する", async () => {
      saveRetro(makeRetro({ id: "keep" }));
      const { ws, session } = makeRequester();
      session.pendingRetros.set("keep", makeRetro({ id: "keep" }));

      await retroDelete(ws, session, {});

      expect(loadRetros().map((r) => r.id)).toEqual(["keep"]);
      expect(session.pendingRetros.has("keep")).toBe(true);
      const syncs = broadcastSent.filter((m) => m.type === "retro_list_sync");
      expect(syncs).toHaveLength(1);
      expect((syncs[0]!.retros as Retrospective[]).map((r) => r.id)).toEqual(["keep"]);
    });
  });
});
