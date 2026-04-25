import { useCallback, useEffect, useRef, useState } from "react";
import type { WSMessage } from "../types";

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 500;

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      // dev は Vite の proxy ('/ws' → backend) が間に入るため常に same-origin で OK。
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelay = 500;
        setConnected(true);
      };
      ws.onclose = (e) => {
        setConnected(false);
        if (disposed) return;
        // 異常切断 (1006/1011 等) は devtools で原因追跡できるよう必ず残す。1000 は通常終了。
        if (e.code !== 1000 && e.code !== 1001) {
          console.warn(`[ws] closed code=${e.code} reason=${e.reason || "(none)"}`);
        }
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
      ws.onerror = (e) => {
        // ブラウザは詳細を秘匿するため Event のみ。少なくとも発生したことはログに残す。
        console.error("[ws] error event:", e);
      };
      ws.onmessage = (e) => {
        let parsed: WSMessage;
        try {
          parsed = JSON.parse(e.data) as WSMessage;
        } catch (err) {
          console.warn("[ws] malformed JSON received:", err);
          return;
        }
        // ハンドラ内のバグを silent にしない。catch しないと WebSocket が握りつぶす。
        try {
          onMessageRef.current(parsed);
        } catch (err) {
          console.error("[ws] handler threw:", err);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { send, connected };
}
