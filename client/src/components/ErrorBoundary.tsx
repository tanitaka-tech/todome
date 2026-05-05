import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// React の render / lifecycle で投げられた例外を画面全体の真っ白化から救うためのバウンダリ。
// useWebSocket や handler 側の throw は別経路で catch されるが、レンダリング中のバグは
// 唯一ここでしか拾えない。i18n や theme が未初期化でも表示できるようにインライン styling。
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] render error:", error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const wrapStyle: React.CSSProperties = {
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      background: "#0f1017",
      color: "#e8eaf1",
      fontFamily:
        '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    };
    const cardStyle: React.CSSProperties = {
      maxWidth: "560px",
      width: "100%",
      background: "#1c1d2a",
      border: "1px solid #2a2c3d",
      borderRadius: "10px",
      padding: "28px 32px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
    };
    const titleStyle: React.CSSProperties = {
      fontSize: "1.25rem",
      fontWeight: 600,
      margin: "0 0 12px",
    };
    const descStyle: React.CSSProperties = {
      color: "#8a8fa3",
      lineHeight: 1.6,
      margin: "0 0 20px",
    };
    const preStyle: React.CSSProperties = {
      background: "#0f1017",
      border: "1px solid #2a2c3d",
      borderRadius: "6px",
      padding: "12px 14px",
      fontSize: "0.85rem",
      color: "#e8eaf1",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      maxHeight: "180px",
      overflow: "auto",
      margin: "0 0 20px",
      fontFamily: '"DM Mono", ui-monospace, "SF Mono", Menlo, monospace',
    };
    const btnRowStyle: React.CSSProperties = { display: "flex", gap: "10px" };
    const primaryBtnStyle: React.CSSProperties = {
      background: "#8a5ff0",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      padding: "10px 18px",
      fontSize: "0.95rem",
      cursor: "pointer",
      fontWeight: 500,
    };
    const secondaryBtnStyle: React.CSSProperties = {
      background: "transparent",
      color: "#e8eaf1",
      border: "1px solid #40435a",
      borderRadius: "6px",
      padding: "10px 18px",
      fontSize: "0.95rem",
      cursor: "pointer",
      fontWeight: 500,
    };

    return (
      <div style={wrapStyle} role="alert">
        <div style={cardStyle}>
          <h1 style={titleStyle}>予期しないエラーが発生しました</h1>
          <p style={descStyle}>
            画面の描画中に問題が起きました。再読み込みすれば復旧することが多いです。
            繰り返し発生する場合は、以下のメッセージを添えて報告してください。
          </p>
          <pre style={preStyle}>{error.message || String(error)}</pre>
          <div style={btnRowStyle}>
            <button type="button" style={primaryBtnStyle} onClick={this.handleReload}>
              再読み込み
            </button>
            <button type="button" style={secondaryBtnStyle} onClick={this.handleReset}>
              この画面のまま続行
            </button>
          </div>
        </div>
      </div>
    );
  }
}
