import { describe, expect, it } from "vitest";

import { createAdminStore } from "../admin.js";
import { StoreError } from "../utils.js";

function createUserRow(overrides: Partial<{ isAdmin: boolean }> = {}) {
  return {
    id: "user-1",
    displayName: "Admin One",
    contact: "admin@example.com",
    contactType: "email",
    isAdmin: overrides.isAdmin ?? true,
    opsAlertImmediateEnabled: false,
    opsAlertDigestEnabled: false,
    opsAlertEscalationTier: "primary",
    status: "active",
    memberSince: new Date("2026-01-01"),
    passwordCredential: null,
    authSessions: []
  };
}

function createPrismaStub(options: { adminCount: number }) {
  const userRow = createUserRow();

  return {
    user: {
      findUnique: async () => userRow,
      update: async () => userRow,
      count: async () => options.adminCount
    },
    passwordCredential: {
      update: async () => null,
      create: async () => null
    }
  };
}

describe("createAdminStore.updateAdmin", () => {
  it("refuses to demote the last remaining admin", async () => {
    const prisma = createPrismaStub({ adminCount: 1 });
    const store = createAdminStore(prisma as never);

    await expect(
      store.updateAdmin({ userId: "user-1", isAdmin: false })
    ).rejects.toThrow(StoreError);
  });

  it("allows demoting an admin when other admins remain", async () => {
    const prisma = createPrismaStub({ adminCount: 2 });
    const store = createAdminStore(prisma as never);

    const result = await store.updateAdmin({ userId: "user-1", isAdmin: false });

    expect(result.id).toBe("user-1");
  });
});
