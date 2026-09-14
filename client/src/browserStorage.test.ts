import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "./browserStorage";

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

describe("browserStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("window がない環境では読み書きを何もしない", () => {
    vi.stubGlobal("window", undefined);

    expect(readLocalStorage("missing")).toBeNull();
    expect(() => writeLocalStorage("key", "value")).not.toThrow();
    expect(() => removeLocalStorage("key")).not.toThrow();
  });

  it("localStorage の読み書きと削除を委譲する", () => {
    const storage = new MemoryStorage({ existing: "value" });
    vi.stubGlobal("window", { localStorage: storage });

    expect(readLocalStorage("existing")).toBe("value");
    writeLocalStorage("next", "saved");
    expect(readLocalStorage("next")).toBe("saved");
    removeLocalStorage("next");
    expect(readLocalStorage("next")).toBeNull();
  });

  it("localStorage が例外を投げても呼び出し元へ伝播しない", () => {
    vi.stubGlobal("window", { localStorage: new ThrowingStorage() });

    expect(readLocalStorage("key")).toBeNull();
    expect(() => writeLocalStorage("key", "value")).not.toThrow();
    expect(() => removeLocalStorage("key")).not.toThrow();
  });
});
