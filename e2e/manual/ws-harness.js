(() => {
  // App の useWebSocket.ts が `new WebSocket(.../ws)` を直叩きするため、
  // アプリ起動前に window.WebSocket を丸ごとスタブ化する。
  // ブラウザ ↔ Claude Agent SDK を通さずに Playwright から決定的に
  // サーバ発メッセージを注入できるようにするのが目的。
  let instance = null;
  const sent = [];

  class StubWebSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0; // CONNECTING
      this.binaryType = "blob";
      this.bufferedAmount = 0;
      this.extensions = "";
      this.protocol = "";
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      instance = this;
      // useWebSocket が onopen を代入した直後に開通したことにする。
      queueMicrotask(() => {
        this.readyState = 1; // OPEN
        const event = new Event("open");
        this.dispatchEvent(event);
        if (typeof this.onopen === "function") this.onopen(event);
      });
    }
    send(data) {
      sent.push(data);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3; // CLOSED
      const event = new Event("close");
      this.dispatchEvent(event);
      if (typeof this.onclose === "function") this.onclose(event);
    }
    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, options);
    }
  }
  StubWebSocket.CONNECTING = 0;
  StubWebSocket.OPEN = 1;
  StubWebSocket.CLOSING = 2;
  StubWebSocket.CLOSED = 3;

  window.WebSocket = StubWebSocket;
  window.__wsSent = sent;
  window.__wsInject = (payload) => {
    if (!instance) return false;
    const data =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    const event = new MessageEvent("message", { data });
    instance.dispatchEvent(event);
    if (typeof instance.onmessage === "function") instance.onmessage(event);
    return true;
  };
})();
