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
      ws.onclose = () => {
        setConnected(false);
        if (disposed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
      ws.onmessage = (e) => {
        try {
          onMessageRef.current(JSON.parse(e.data));
        } catch {
          /* ignore malformed */
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
