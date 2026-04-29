import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getAllowedOrigins, isAllowedOrigin } from "./origin.ts";

describe("getAllowedOrigins", () => {
  const originalEnv = process.env.TODOME_ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TODOME_ALLOWED_ORIGINS;
    else process.env.TODOME_ALLOWED_ORIGINS = originalEnv;
  });

  it("環境変数未設定時はローカルホストのデフォルトを返す", () => {
    delete process.env.TODOME_ALLOWED_ORIGINS;
    const list = getAllowedOrigins();
    expect(list).toContain("http://localhost:5173");
    expect(list).toContain("http://127.0.0.1:5173");
    expect(list).toContain("http://localhost:3002");
  });

  it("カンマ区切りで複数オリジンを読む", () => {
    process.env.TODOME_ALLOWED_ORIGINS =
      "https://app.example.com, https://staging.example.com ,https://other.example";
    expect(getAllowedOrigins()).toEqual([
      "https://app.example.com",
      "https://staging.example.com",
      "https://other.example",
    ]);
  });

  it("空文字や空白のみのエントリは無視する", () => {
    process.env.TODOME_ALLOWED_ORIGINS = " , https://app.example.com ,  ";
    expect(getAllowedOrigins()).toEqual(["https://app.example.com"]);
  });

  it("空文字環境変数はデフォルトに fallback する", () => {
    process.env.TODOME_ALLOWED_ORIGINS = "   ";
    const list = getAllowedOrigins();
    expect(list).toContain("http://localhost:5173");
  });
});

describe("isAllowedOrigin", () => {
  const originalEnv = process.env.TODOME_ALLOWED_ORIGINS;

  beforeEach(() => {
    delete process.env.TODOME_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TODOME_ALLOWED_ORIGINS;
    else process.env.TODOME_ALLOWED_ORIGINS = originalEnv;
  });

  it("Origin ヘッダがない場合は許可する（非ブラウザクライアント）", () => {
    expect(isAllowedOrigin(null, "todome.example:3002")).toBe(true);
    expect(isAllowedOrigin(undefined, null)).toBe(true);
    expect(isAllowedOrigin("", null)).toBe(true);
  });

  it("デフォルトのローカルホストは許可される", () => {
    expect(isAllowedOrigin("http://localhost:5173", "localhost:3002")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173", "localhost:3002")).toBe(true);
  });

  it("ホワイトリスト外のオリジンは拒否される", () => {
    expect(isAllowedOrigin("https://evil.example.com", "localhost:3002")).toBe(false);
    expect(isAllowedOrigin("http://attacker.test", "localhost:3002")).toBe(false);
  });

  it("Host が一致するオリジンは same-origin として許可する", () => {
    process.env.TODOME_ALLOWED_ORIGINS = "https://app.example.com";
    expect(isAllowedOrigin("http://my-server.local:3002", "my-server.local:3002")).toBe(true);
    expect(isAllowedOrigin("https://my-server.local:3002", "my-server.local:3002")).toBe(true);
  });

  it("Host が一致しない外部オリジンは拒否する", () => {
    process.env.TODOME_ALLOWED_ORIGINS = "https://app.example.com";
    expect(isAllowedOrigin("https://evil.example.com", "my-server.local:3002")).toBe(false);
  });

  it("ワイルドカード '*' は全許可", () => {
    process.env.TODOME_ALLOWED_ORIGINS = "*";
    expect(isAllowedOrigin("https://anywhere.example", "localhost:3002")).toBe(true);
    expect(isAllowedOrigin("http://attacker.test", "localhost:3002")).toBe(true);
  });

  it("環境変数で明示したオリジンは許可、デフォルトは無効化される", () => {
    process.env.TODOME_ALLOWED_ORIGINS = "https://app.example.com";
    expect(isAllowedOrigin("https://app.example.com", "app.example.com")).toBe(true);
    // デフォルトのローカルホストは含まれなくなる
    expect(isAllowedOrigin("http://localhost:5173", "app.example.com")).toBe(false);
  });

  it("不正な URL の Origin は拒否する", () => {
    expect(isAllowedOrigin("not-a-url", "localhost:3002")).toBe(false);
  });
});
