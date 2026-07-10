import { describe, expect, it } from "vitest";

import { createAuthStore, authSessionTtlMs, maxVerificationAttempts, maxLoginAttempts } from "../auth.js";
import { hashPassword, verifyPassword } from "../utils.js";
import type { MessageTransport, MessageTransportInput, MessageTransportResult } from "../../transport/message-transport.js";

const noopTransport: MessageTransport = {
  async deliver() {
    return {
      status: "delivered",
      deliveryPath: "local_dev_outbox",
      providerMessageId: "local-dev:test",
      deliveredAt: new Date()
    } satisfies MessageTransportResult;
  }
};

function createPrismaStub(capturedCreateData: { current: Record<string, unknown> | null }) {
  return {
    user: {
      findFirst: async () => null
    },
    verificationChallenge: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        capturedCreateData.current = data;
        return {
          id: data.id,
          expiresAt: data.expiresAt as Date
        };
      }
    }
  };
}

describe("createAuthStore.requestAuthChallenge", () => {
  it("never returns the plaintext code and delivers it via the transport instead", async () => {
    const capturedCreateData: { current: Record<string, unknown> | null } = { current: null };
    const prisma = createPrismaStub(capturedCreateData);

    let deliveredInput: MessageTransportInput | null = null;
    const transport: MessageTransport = {
      async deliver(input) {
        deliveredInput = input;
        return {
          status: "delivered",
          deliveryPath: "resend_api",
          providerMessageId: "msg-1",
          deliveredAt: new Date()
        } satisfies MessageTransportResult;
      }
    };

    const store = createAuthStore(prisma as never, transport);

    const result = await store.requestAuthChallenge({
      provider: "email",
      target: "user@example.com"
    });

    expect(result).not.toHaveProperty("code");
    expect(result).not.toHaveProperty("codeHash");
    expect(Object.keys(result).sort()).toEqual(["challengeId", "expiresAt", "provider", "target"].sort());

    expect(deliveredInput).not.toBeNull();
    expect(deliveredInput!.channel).toBe("email");
    expect(deliveredInput!.recipientContact).toBe("user@example.com");

    const codeMatch = deliveredInput!.message.match(/\d{6}/);
    expect(codeMatch).not.toBeNull();

    const codeHash = capturedCreateData.current?.codeHash as string;
    expect(await verifyPassword(codeMatch![0], codeHash)).toBe(true);
  });

  it("falls back to logging the code and does not throw when no transport is configured", async () => {
    const capturedCreateData: { current: Record<string, unknown> | null } = { current: null };
    const prisma = createPrismaStub(capturedCreateData);

    const transport: MessageTransport = {
      async deliver() {
        return {
          status: "delivered",
          deliveryPath: "local_dev_outbox",
          providerMessageId: "local-dev:1",
          deliveredAt: new Date()
        } satisfies MessageTransportResult;
      }
    };

    const store = createAuthStore(prisma as never, transport);

    const result = await store.requestAuthChallenge({
      provider: "telegram",
      target: "@someone"
    });

    expect(result).not.toHaveProperty("code");
  });

  it("surfaces a delivery failure instead of silently succeeding", async () => {
    const capturedCreateData: { current: Record<string, unknown> | null } = { current: null };
    const prisma = createPrismaStub(capturedCreateData);

    const transport: MessageTransport = {
      async deliver() {
        return {
          status: "failed",
          deliveryPath: "resend_api",
          providerMessageId: null,
          deliveredAt: null,
          failureReason: "boom"
        } satisfies MessageTransportResult;
      }
    };

    const store = createAuthStore(prisma as never, transport);

    await expect(
      store.requestAuthChallenge({
        provider: "email",
        target: "user@example.com"
      })
    ).rejects.toThrow("Failed to deliver verification code");
  });

  it("rejects a new challenge for the same target within the cooldown window", async () => {
    const capturedCreateData: { current: Record<string, unknown> | null } = { current: null };
    const prisma = {
      ...createPrismaStub(capturedCreateData),
      verificationChallenge: {
        ...createPrismaStub(capturedCreateData).verificationChallenge,
        findFirst: async () => ({
          id: "prev-challenge",
          createdAt: new Date(Date.now() - 5_000)
        })
      }
    };

    const store = createAuthStore(prisma as never, noopTransport);

    await expect(
      store.requestAuthChallenge({
        provider: "email",
        target: "user@example.com"
      })
    ).rejects.toThrow("Too many requests");

    expect(capturedCreateData.current).toBeNull();
  });

  it("allows a new challenge for the same target once the cooldown has elapsed", async () => {
    const capturedCreateData: { current: Record<string, unknown> | null } = { current: null };
    const prisma = {
      ...createPrismaStub(capturedCreateData),
      verificationChallenge: {
        ...createPrismaStub(capturedCreateData).verificationChallenge,
        findFirst: async () => ({
          id: "prev-challenge",
          createdAt: new Date(Date.now() - 120_000)
        })
      }
    };

    const store = createAuthStore(prisma as never, noopTransport);

    const result = await store.requestAuthChallenge({
      provider: "email",
      target: "user@example.com"
    });

    expect(result.challengeId).toBeDefined();
  });
});

describe("createAuthStore.loginWithPassword session expiry", () => {
  it("issues a session with an absolute expiry instead of an eternal one", async () => {
    const passwordHash = await hashPassword("secret123");
    const capturedSession: { current: Record<string, unknown> | null } = { current: null };

    const prisma = {
      passwordCredential: {
        findUnique: async () => ({
          userId: "user-1",
          passwordHash,
          user: {
            id: "user-1",
            displayName: "Alice",
            contact: "alice",
            contactType: "telegram",
            isAdmin: false,
            status: "active",
            memberSince: new Date(),
            vlessUuid: null,
            subscription: null,
            devices: [],
            passwordCredential: { login: "alice" }
          }
        })
      },
      authSession: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          capturedSession.current = create;
          return create;
        }
      }
    };

    const store = createAuthStore(prisma as never, noopTransport);

    const before = Date.now();
    const result = await store.loginWithPassword({ login: "alice", password: "secret123" });

    expect(result.auth.expiresAt).not.toBeNull();
    const expiresMs = new Date(result.auth.expiresAt as string).getTime();
    expect(expiresMs).toBeGreaterThan(before);
    expect(expiresMs).toBeLessThanOrEqual(before + authSessionTtlMs + 1000);
    expect(capturedSession.current?.expiresAt).toBeInstanceOf(Date);
  });
});

describe("createAuthStore.loginWithPassword lockout", () => {
  function credentialRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "cred-1",
      userId: "user-1",
      passwordHash: "irrelevant",
      failedLoginAttempts: 0,
      lockedUntil: null,
      user: {
        id: "user-1",
        displayName: "Alice",
        contact: "alice",
        contactType: "telegram",
        isAdmin: false,
        status: "active",
        memberSince: new Date(),
        vlessUuid: null,
        subscription: null,
        devices: [],
        passwordCredential: { login: "alice" }
      },
      ...overrides
    };
  }

  it("rejects login while the account is locked out, even with the right password", async () => {
    const passwordHash = await hashPassword("secret123");
    const prisma = {
      passwordCredential: {
        findUnique: async () => credentialRow({ passwordHash, lockedUntil: new Date(Date.now() + 60_000) })
      }
    };

    const store = createAuthStore(prisma as never, noopTransport);

    await expect(
      store.loginWithPassword({ login: "alice", password: "secret123" })
    ).rejects.toThrow("Too many failed attempts");
  });

  it("locks the account out after too many wrong passwords", async () => {
    const passwordHash = await hashPassword("secret123");
    const captured: { current: Record<string, unknown> | null } = { current: null };
    const prisma = {
      passwordCredential: {
        findUnique: async () => credentialRow({ passwordHash, failedLoginAttempts: maxLoginAttempts - 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          captured.current = data;
          return data;
        }
      }
    };

    const store = createAuthStore(prisma as never, noopTransport);

    await expect(
      store.loginWithPassword({ login: "alice", password: "wrong-password" })
    ).rejects.toThrow("Too many failed attempts");

    expect(captured.current?.lockedUntil).toBeInstanceOf(Date);
    expect(captured.current?.failedLoginAttempts).toBe(0);
  });

  it("increments the failed-attempt counter without locking on a single wrong password", async () => {
    const passwordHash = await hashPassword("secret123");
    const captured: { current: Record<string, unknown> | null } = { current: null };
    const prisma = {
      passwordCredential: {
        findUnique: async () => credentialRow({ passwordHash }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          captured.current = data;
          return data;
        }
      }
    };

    const store = createAuthStore(prisma as never, noopTransport);

    await expect(
      store.loginWithPassword({ login: "alice", password: "wrong-password" })
    ).rejects.toThrow("Invalid login or password");

    expect(captured.current?.failedLoginAttempts).toBe(1);
    expect(captured.current?.lockedUntil).toBeNull();
  });
});

describe("createAuthStore.verifyAuthChallenge attempt limit", () => {
  function createVerifyPrisma(challenge: Record<string, unknown>, captured: { current: Record<string, unknown> | null }) {
    return {
      verificationChallenge: {
        findUnique: async () => challenge,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          captured.current = data;
          return { ...challenge, ...data };
        }
      }
    };
  }

  it("increments attempts and keeps the challenge pending on a single invalid code", async () => {
    const codeHash = await hashPassword("123456");
    const captured: { current: Record<string, unknown> | null } = { current: null };
    const prisma = createVerifyPrisma(
      {
        id: "challenge-1",
        userId: null,
        provider: "email",
        target: "user@example.com",
        codeHash,
        status: "pending",
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000)
      },
      captured
    );

    const store = createAuthStore(prisma as never, noopTransport);

    await expect(
      store.verifyAuthChallenge({ challengeId: "challenge-1", code: "000000", displayName: "" })
    ).rejects.toThrow("Invalid verification code");

    expect(captured.current?.attempts).toBe(1);
    expect(captured.current?.status).toBe("pending");
  });

  it("expires the challenge after too many invalid attempts", async () => {
    const codeHash = await hashPassword("123456");
    const captured: { current: Record<string, unknown> | null } = { current: null };
    const prisma = createVerifyPrisma(
      {
        id: "challenge-1",
        userId: null,
        provider: "email",
        target: "user@example.com",
        codeHash,
        status: "pending",
        attempts: maxVerificationAttempts - 1,
        expiresAt: new Date(Date.now() + 60_000)
      },
      captured
    );

    const store = createAuthStore(prisma as never, noopTransport);

    await expect(
      store.verifyAuthChallenge({ challengeId: "challenge-1", code: "000000", displayName: "" })
    ).rejects.toThrow("Too many invalid attempts");

    expect(captured.current?.attempts).toBe(maxVerificationAttempts);
    expect(captured.current?.status).toBe("expired");
  });
});
