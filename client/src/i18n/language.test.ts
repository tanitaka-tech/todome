import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLanguage, getInitialLanguage } from "./language";

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

describe("language storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("保存済み言語を初期値に使う", () => {
    vi.stubGlobal("window", {
      localStorage: new MemoryStorage({ "todome.language": "en" }),
      navigator: { language: "ja-JP" },
    });

    expect(getInitialLanguage()).toBe("en");
  });

  it("localStorage が読めないときは navigator の言語へ戻す", () => {
    vi.stubGlobal("window", {
      localStorage: new ThrowingStorage(),
      navigator: { language: "en-US" },
    });

    expect(getInitialLanguage()).toBe("en");
  });

  it("言語適用時に保存できなくても document lang は更新する", () => {
    const storage = new ThrowingStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("document", {
      documentElement: { lang: "" },
    });

    expect(() => applyLanguage("ja")).not.toThrow();
    expect(document.documentElement.lang).toBe("ja");
  });
});
