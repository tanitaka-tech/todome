import { describe, expect, test } from "bun:test";
import { describeGoogleApiError } from "./client.ts";

function makeResponse(status: number, body: unknown): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("describeGoogleApiError", () => {
  test("SERVICE_DISABLED is rewritten to a friendly message including the activation URL", async () => {
    const res = makeResponse(403, {
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        message:
          "Google Calendar API has not been used in project 133942074606 before or it is disabled.",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "SERVICE_DISABLED",
            domain: "googleapis.com",
            metadata: {
              serviceTitle: "Google Calendar API",
              activationUrl:
                "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=133942074606",
              service: "calendar-json.googleapis.com",
              consumer: "projects/133942074606",
              containerInfo: "133942074606",
            },
          },
        ],
      },
    });
    const msg = await describeGoogleApiError(res, "calendarList failed");
    expect(msg).toContain("Google Calendar API");
    expect(msg).toContain("有効化");
    expect(msg).toContain(
      "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=133942074606",
    );
    // 元の長大な JSON 本文が含まれていないこと（読みづらさを防ぐ）
    expect(msg).not.toContain("ErrorInfo");
    expect(msg).not.toContain("\"@type\"");
  });

  test("non-SERVICE_DISABLED error falls back to label + code + message", async () => {
    const res = makeResponse(404, {
      error: { code: 404, status: "NOT_FOUND", message: "Not Found" },
    });
    const msg = await describeGoogleApiError(res, "events.list failed");
    expect(msg).toBe("events.list failed (404): Not Found");
  });

  test("non-JSON body is preserved verbatim with status prefix", async () => {
    const res = makeResponse(500, "<!DOCTYPE html>...crash...");
    const msg = await describeGoogleApiError(res, "events.list failed");
    expect(msg).toBe("events.list failed (500): <!DOCTYPE html>...crash...");
  });

  test("empty error object falls back to raw body", async () => {
    const res = makeResponse(401, { error: {} });
    const msg = await describeGoogleApiError(res, "calendarList failed");
    expect(msg).toContain("calendarList failed (401)");
  });
});
