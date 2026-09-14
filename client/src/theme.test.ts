import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getInitialTheme } from "./theme";

class MemoryStorage implements Storage {
  private values: Record<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.values = { ...values };
  }

  get length(): number {
    return Object.keys(this.values).length;
  }

  clear(): void {
    this.values = {};
  }

  getItem(key: string): string | null {
    return this.values[key] ?? null;
  }

  key(index: number): string | null {
    return Object.keys(this.values)[index] ?? null;
  }

  removeItem(key: string): void {
    delete this.values[key];
  }

  setItem(key: string, value: string): void {
    this.values[key] = value;
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error("storage unavailable");
  }

  clear(): void {
    throw new Error("storage unavailable");
  }

  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  key(): string | null {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }
}

describe("theme storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("保存済みテーマを初期値に使う", () => {
    vi.stubGlobal("window", {
      localStorage: new MemoryStorage({ "todome.theme": "forest" }),
    });

    expect(getInitialTheme()).toBe("forest");
  });

  it("localStorage が読めないときは既定テーマに戻す", () => {
    vi.stubGlobal("window", { localStorage: new ThrowingStorage() });

    expect(getInitialTheme()).toBe("dark");
  });

  it("テーマ適用時に保存できなくても data-theme は更新する", () => {
    const setAttribute = vi.fn();
    vi.stubGlobal("window", { localStorage: new ThrowingStorage() });
    vi.stubGlobal("document", {
      documentElement: { setAttribute },
    });

    expect(() => applyTheme("rose")).not.toThrow();
    expect(setAttribute).toHaveBeenCalledWith("data-theme", "rose");
  });
});
