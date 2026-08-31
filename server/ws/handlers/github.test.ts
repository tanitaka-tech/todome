import { describe, expect, it } from "bun:test";
import {
  parseGitHubAutoSyncValue,
  parseGitHubLinkOptions,
  githubLink,
} from "./github.ts";
import { createSessionState, type AppWebSocket } from "../../state.ts";

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function makeFakeWs(): { ws: AppWebSocket; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  const ws = {
    data: { id: "github-handler-test", session: createSessionState() },
    send(payload: string) {
      sent.push(JSON.parse(payload) as SentMessage);
    },
  } as unknown as AppWebSocket;
  return { ws, sent };
}

describe("parseGitHubLinkOptions", () => {
  it("trims owner and repo name while preserving boolean options", () => {
    expect(
      parseGitHubLinkOptions({
        owner: " tanitaka-tech ",
        name: " todome ",
        create: true,
        private: false,
      }),
    ).toEqual({
      owner: "tanitaka-tech",
      name: "todome",
      create: true,
      private: false,
    });
  });

  it("empty repo names are rejected", () => {
    expect(parseGitHubLinkOptions({ owner: "me", name: " " })).toBeNull();
    expect(parseGitHubLinkOptions({ owner: "me" })).toBeNull();
  });

  it("non-boolean create/private values do not become truthy booleans", () => {
    expect(
      parseGitHubLinkOptions({
        owner: "me",
        name: "todome",
        create: "false",
        private: "false",
      }),
    ).toEqual({
      owner: "me",
      name: "todome",
      create: false,
      private: true,
    });
  });

  it("non-string owner is treated as unspecified", () => {
    expect(parseGitHubLinkOptions({ owner: 123, name: "todome" })).toMatchObject({
      owner: null,
      name: "todome",
    });
  });
});

describe("parseGitHubAutoSyncValue", () => {
  it("accepts booleans and preserves the legacy undefined=true behavior", () => {
    expect(parseGitHubAutoSyncValue(true)).toBe(true);
    expect(parseGitHubAutoSyncValue(false)).toBe(false);
    expect(parseGitHubAutoSyncValue(undefined)).toBe(true);
  });

  it("rejects string and numeric booleans instead of coercing them", () => {
    expect(parseGitHubAutoSyncValue("false")).toBeNull();
    expect(parseGitHubAutoSyncValue("true")).toBeNull();
    expect(parseGitHubAutoSyncValue(1)).toBeNull();
  });
});

describe("githubLink handler", () => {
  it("invalid repo name returns an error without starting link flow", async () => {
    const { ws, sent } = makeFakeWs();

    await githubLink(ws, ws.data.session, { name: " " });

    expect(sent).toEqual([
      {
        type: "error",
        scope: "handler",
        requestType: "github_link",
        message: "GitHub リポジトリ名が不正です",
      },
    ]);
  });
});
