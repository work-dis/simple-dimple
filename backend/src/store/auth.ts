import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { AuthProvider, AuthSessionStatus, SubscriptionStatus, UserStatus, VerificationChallengeStatus } from "../generated/prisma/client.js";
import { defaultAccount } from "../defaults.js";
import type {
  AccountSummary,
  AuthSessionSummary,
  LoginWithPasswordBody,
  RegisterWithPasswordBody,
  RequestAuthChallengeBody,
  VerifyAuthChallengeBody,
  VerificationChallengeProvider
} from "../types.js";
import {
  StoreAuthError,
  hashPassword,
  verifyPassword,
  normalizeAuthSession,
  mapUserRowToAccount,
  trimmedContactLooksLikeEmail
} from "./utils.js";
import {
  loadUserAccountById,
  findUserByVerificationTarget
} from "./shared.js";

// --------------------------------------------------------------------------
// AuthStore
// --------------------------------------------------------------------------

export function createAuthStore(prisma: PrismaClient) {
  async function activateCredentialsSession(userId: string) {
    const nextAuthSession = normalizeAuthSession({
      id: randomUUID(),
      userId,
      provider: "credentials",
      status: "active",
      isAuthenticated: true,
      lastAuthenticatedAt: new Date().toISOString(),
      expiresAt: null
    });

    await prisma.authSession.upsert({
      where: { id: nextAuthSession.id },
      update: {
        userId: nextAuthSession.userId,
        provider: AuthProvider.credentials,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt: null,
        revokedAt: null
      },
      create: {
        id: nextAuthSession.id,
        userId: nextAuthSession.userId,
        provider: AuthProvider.credentials,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt: null,
        revokedAt: null
      }
    });

    return nextAuthSession;
  }

  async function activateSessionForProvider(userId: string, provider: VerificationChallengeProvider) {
    const nextAuthSession = normalizeAuthSession({
      id: randomUUID(),
      userId,
      provider,
      status: "active",
      isAuthenticated: true,
      lastAuthenticatedAt: new Date().toISOString(),
      expiresAt: null
    });

    await prisma.authSession.upsert({
      where: { id: nextAuthSession.id },
      update: {
        userId: nextAuthSession.userId,
        provider: provider === "email" ? AuthProvider.email : AuthProvider.telegram,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt: null,
        revokedAt: null
      },
      create: {
        id: nextAuthSession.id,
        userId: nextAuthSession.userId,
        provider: provider === "email" ? AuthProvider.email : AuthProvider.telegram,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt: null,
        revokedAt: null
      }
    });

    return nextAuthSession;
  }

  return {
    async loginWithPassword(input: Required<LoginWithPasswordBody>): Promise<{ auth: AuthSessionSummary; account: AccountSummary }> {
      const credential = await prisma.passwordCredential.findUnique({
        where: { login: input.login },
        include: {
          user: {
            include: {
              subscription: true,
              devices: {
                orderBy: {
                  createdAt: "asc"
                }
              },
              passwordCredential: true
            }
          }
        }
      });

      if (!credential) {
        throw new StoreAuthError("Invalid login or password", 401);
      }

      const isPasswordValid = await verifyPassword(input.password, credential.passwordHash);

      if (!isPasswordValid) {
        throw new StoreAuthError("Invalid login or password", 401);
      }

      if (credential.user.status === UserStatus.blocked) {
        throw new StoreAuthError("Account is blocked", 403);
      }

      const nextAuthSession = await activateCredentialsSession(credential.userId);

      return {
        auth: nextAuthSession,
        account: mapUserRowToAccount(credential.user)
      };
    },

    async registerWithPassword(input: Required<RegisterWithPasswordBody>): Promise<{ auth: AuthSessionSummary; account: AccountSummary }> {
      const existingCredential = await prisma.passwordCredential.findUnique({
        where: { login: input.login }
      });

      if (existingCredential) {
        throw new StoreAuthError("Login is already taken", 409);
      }

      const passwordHash = await hashPassword(input.password);
      const userId = randomUUID();
      const contactType = trimmedContactLooksLikeEmail(input.login) ? "email" : "telegram";
      const createdAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            displayName: input.displayName,
            contact: input.login,
            contactType,
            isAdmin: false,
            status: UserStatus.active,
            memberSince: createdAt
          }
        });

        await tx.subscription.create({
          data: {
            id: `${userId}-subscription`,
            userId,
            plan: defaultAccount.subscription.plan,
            renewalDate: new Date(defaultAccount.subscription.renewalDate),
            status: SubscriptionStatus.active,
            autoRenew: defaultAccount.subscription.autoRenew
          }
        });

        await tx.passwordCredential.create({
          data: {
            id: `${userId}-password`,
            userId,
            login: input.login,
            passwordHash
          }
        });
      });

      const nextAuthSession = await activateCredentialsSession(userId);
      const nextAccount = await loadUserAccountById(prisma, userId);

      return {
        auth: nextAuthSession,
        account: nextAccount
      };
    },

    async requestAuthChallenge(input: Required<RequestAuthChallengeBody>): Promise<{ challengeId: string; code: string; provider: VerificationChallengeProvider; target: string; expiresAt: string }> {
      if (input.provider !== "email" && input.provider !== "telegram") {
        throw new StoreAuthError("Unsupported verification provider", 400);
      }

      const target = normalizeVerificationTarget(input.provider, input.target);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const existingUser = await findUserByVerificationTarget(prisma, input.provider, target);

      await prisma.verificationChallenge.updateMany({
        where: {
          provider: input.provider === "email" ? AuthProvider.email : AuthProvider.telegram,
          target,
          status: VerificationChallengeStatus.pending
        },
        data: {
          status: VerificationChallengeStatus.expired
        }
      });

      const challenge = await prisma.verificationChallenge.create({
        data: {
          id: randomUUID(),
          userId: existingUser?.id ?? null,
          provider: input.provider === "email" ? AuthProvider.email : AuthProvider.telegram,
          target,
          codeHash,
          status: VerificationChallengeStatus.pending,
          expiresAt
        }
      });

      return {
        challengeId: challenge.id,
        code,
        provider: input.provider,
        target,
        expiresAt: challenge.expiresAt.toISOString()
      };
    },

    async verifyAuthChallenge(input: Required<VerifyAuthChallengeBody>): Promise<{ auth: AuthSessionSummary; account: AccountSummary }> {
      const challenge = await prisma.verificationChallenge.findUnique({
        where: { id: input.challengeId }
      });

      if (!challenge) {
        throw new StoreAuthError("Verification challenge not found", 404);
      }

      if (challenge.status !== VerificationChallengeStatus.pending) {
        throw new StoreAuthError("Verification challenge is no longer active", 400);
      }

      if (challenge.expiresAt.getTime() <= Date.now()) {
        await prisma.verificationChallenge.update({
          where: { id: challenge.id },
          data: {
            status: VerificationChallengeStatus.expired
          }
        });
        throw new StoreAuthError("Verification code has expired", 410);
      }

      const isCodeValid = await verifyPassword(input.code, challenge.codeHash);

      if (!isCodeValid) {
        throw new StoreAuthError("Invalid verification code", 401);
      }

      const provider = challenge.provider === AuthProvider.email ? "email" : "telegram";
      const target = normalizeVerificationTarget(provider, challenge.target);

      let userRow = await findUserByVerificationTarget(prisma, provider, target);

      if (!userRow) {
        const userId = randomUUID();
        const displayName = input.displayName.trim() || target;
        const createdAt = new Date();

        await prisma.$transaction(async (tx) => {
          await tx.user.create({
            data: {
              id: userId,
              displayName,
              contact: target,
              contactType: provider === "email" ? "email" : "telegram",
              isAdmin: false,
              status: UserStatus.active,
              memberSince: createdAt
            }
          });

          await tx.subscription.create({
            data: {
              id: `${userId}-subscription`,
              userId,
              plan: defaultAccount.subscription.plan,
              renewalDate: new Date(defaultAccount.subscription.renewalDate),
              status: SubscriptionStatus.active,
              autoRenew: defaultAccount.subscription.autoRenew
            }
          });

          await tx.verificationChallenge.update({
            where: { id: challenge.id },
            data: {
              userId,
              status: VerificationChallengeStatus.consumed,
              consumedAt: new Date()
            }
          });
        });

        userRow = await findUserByVerificationTarget(prisma, provider, target);
      } else {
        await prisma.verificationChallenge.update({
          where: { id: challenge.id },
          data: {
            userId: userRow.id,
            status: VerificationChallengeStatus.consumed,
            consumedAt: new Date()
          }
        });
      }

      if (!userRow) {
        throw new StoreAuthError("Verified user could not be loaded", 500);
      }

      if (userRow.status === UserStatus.blocked) {
        throw new StoreAuthError("Account is blocked", 403);
      }

      const nextAuthSession = await activateSessionForProvider(userRow.id, provider);

      return {
        auth: nextAuthSession,
        account: mapUserRowToAccount(userRow)
      };
    },

    async logout(): Promise<AuthSessionSummary> {
      const nextAuthSession = normalizeAuthSession({
        id: randomUUID(),
        userId: null,
        provider: "credentials",
        status: "revoked",
        isAuthenticated: false,
        lastAuthenticatedAt: new Date().toISOString(),
        expiresAt: null
      });

      await prisma.authSession.upsert({
        where: { id: nextAuthSession.id },
        update: {
          userId: null,
          provider: AuthProvider.credentials,
          status: AuthSessionStatus.revoked,
          lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
          expiresAt: null,
          revokedAt: new Date()
        },
        create: {
          id: nextAuthSession.id,
          userId: null,
          provider: AuthProvider.credentials,
          status: AuthSessionStatus.revoked,
          lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
          expiresAt: null,
          revokedAt: new Date()
        }
      });

      return nextAuthSession;
    }
  };
}

// Re-export for backward compatibility with normalizeVerificationTarget usage
import { normalizeVerificationTarget } from "./utils.js";
