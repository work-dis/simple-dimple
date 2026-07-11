import { afterEach, describe, expect, it } from "vitest";

import { isValidFleetSyncToken } from "../routes/context.js";

// Scoped-токен для deploy/xray/sync-clients.sh — см. routes/context.ts.
// Ключевое свойство: не заданный/слишком короткий FLEET_SYNC_TOKEN полностью
// выключает этот путь аутентификации, а не превращается в слабый секрет.

const originalToken = process.env.FLEET_SYNC_TOKEN;

function requestWithToken(token?: string) {
  return {
    headers: token === undefined ? {} : { "x-fleet-sync-token": token }
  };
}

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.FLEET_SYNC_TOKEN;
  } else {
    process.env.FLEET_SYNC_TOKEN = originalToken;
  }
});

describe("isValidFleetSyncToken", () => {
  it("accepts the exact configured token", () => {
    process.env.FLEET_SYNC_TOKEN = "fleet-sync-token-0123456789abcdef";
    expect(isValidFleetSyncToken(requestWithToken("fleet-sync-token-0123456789abcdef"))).toBe(true);
  });

  it("rejects a wrong token", () => {
    process.env.FLEET_SYNC_TOKEN = "fleet-sync-token-0123456789abcdef";
    expect(isValidFleetSyncToken(requestWithToken("fleet-sync-token-0123456789abcdeX"))).toBe(false);
    expect(isValidFleetSyncToken(requestWithToken("short"))).toBe(false);
    expect(isValidFleetSyncToken(requestWithToken(""))).toBe(false);
    expect(isValidFleetSyncToken(requestWithToken())).toBe(false);
  });

  it("is disabled entirely when the env token is missing or too short", () => {
    delete process.env.FLEET_SYNC_TOKEN;
    expect(isValidFleetSyncToken(requestWithToken(""))).toBe(false);
    expect(isValidFleetSyncToken(requestWithToken())).toBe(false);

    // Заглушка вроде "test" не должна стать рабочим обходом admin-аутентификации.
    process.env.FLEET_SYNC_TOKEN = "test";
    expect(isValidFleetSyncToken(requestWithToken("test"))).toBe(false);
  });

  it("handles a repeated header (array) by using the first value", () => {
    process.env.FLEET_SYNC_TOKEN = "fleet-sync-token-0123456789abcdef";
    expect(
      isValidFleetSyncToken({
        headers: { "x-fleet-sync-token": ["fleet-sync-token-0123456789abcdef", "junk"] }
      })
    ).toBe(true);
  });
});
