import { randomInt, randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import type { MessageTransport } from "../transport/message-transport.js";
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
  trimmedContactLooksLikeEmail,
  cloneDefaultAccount,
  cloneDefaultAuthSession,
  mapAuthSessionRow
} from "./utils.js";
import {
  loadUserAccountById,
  findUserByVerificationTarget
} from "./shared.js";

// --------------------------------------------------------------------------
// AuthStore
// --------------------------------------------------------------------------

// Absolute срок жизни auth-сессии. Раньше сессии создавались с expiresAt: null
// (вечные и неотзываемые по времени) — украденный x-auth-session-id действовал
// бесконечно. Теперь каждая сессия истекает через фиксированное окно; mapAuthSessionRow
// уже переводит просроченную сессию в status "expired"/isAuthenticated=false при чтении.
export const authSessionTtlMs = 30 * 24 * 60 * 60 * 1000;

// Максимальное число неверных попыток ввода OTP на один challenge. После этого
// challenge принудительно гасится (status: expired), чтобы 6-значный код нельзя было
// перебрать в пределах его 10-минутного окна жизни.
export const maxVerificationAttempts = 5;

export function createAuthStore(prisma: PrismaClient, transport: MessageTransport) {
  async function activateCredentialsSession(userId: string) {
    const expiresAt = new Date(Date.now() + authSessionTtlMs);
    const nextAuthSession = normalizeAuthSession({
      id: randomUUID(),
      userId,
      provider: "credentials",
      status: "active",
      isAuthenticated: true,
      lastAuthenticatedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    await prisma.authSession.upsert({
      where: { id: nextAuthSession.id },
      update: {
        userId: nextAuthSession.userId,
        provider: AuthProvider.credentials,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt,
        revokedAt: null
      },
      create: {
        id: nextAuthSession.id,
        userId: nextAuthSession.userId,
        provider: AuthProvider.credentials,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt,
        revokedAt: null
      }
    });

    return nextAuthSession;
  }

  async function activateSessionForProvider(userId: string, provider: VerificationChallengeProvider) {
    const expiresAt = new Date(Date.now() + authSessionTtlMs);
    const nextAuthSession = normalizeAuthSession({
      id: randomUUID(),
      userId,
      provider,
      status: "active",
      isAuthenticated: true,
      lastAuthenticatedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    await prisma.authSession.upsert({
      where: { id: nextAuthSession.id },
      update: {
        userId: nextAuthSession.userId,
        provider: provider === "email" ? AuthProvider.email : AuthProvider.telegram,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt,
        revokedAt: null
      },
      create: {
        id: nextAuthSession.id,
        userId: nextAuthSession.userId,
        provider: provider === "email" ? AuthProvider.email : AuthProvider.telegram,
        status: AuthSessionStatus.active,
        lastAuthenticatedAt: nextAuthSession.lastAuthenticatedAt ? new Date(nextAuthSession.lastAuthenticatedAt) : null,
        expiresAt,
        revokedAt: null
      }
    });

    return nextAuthSession;
  }

  return {
    async readAuthContext(sessionId?: string | null): Promise<{ auth: AuthSessionSummary; account: AccountSummary }> {
      const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";

      if (!trimmedSessionId) {
        return {
          auth: cloneDefaultAuthSession(),
          account: cloneDefaultAccount()
        };
      }

      const authSessionRow = await prisma.authSession.findUnique({
        where: { id: trimmedSessionId }
      });
      const auth = mapAuthSessionRow(authSessionRow);
      const account = auth.isAuthenticated && auth.userId
        ? await loadUserAccountById(prisma, auth.userId)
        : cloneDefaultAccount();

      return {
        auth,
        account
      };
    },

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

    async requestAuthChallenge(input: Required<RequestAuthChallengeBody>): Promise<{ challengeId: string; provider: VerificationChallengeProvider; target: string; expiresAt: string }> {
      if (input.provider !== "email" && input.provider !== "telegram") {
        throw new StoreAuthError("Unsupported verification provider", 400);
      }

      const target = normalizeVerificationTarget(input.provider, input.target);
      // CSPRNG вместо Math.random(): состояние обычного PRNG предсказуемо и
      // 6-значный OTP из него теоретически восстановим. randomInt даёт
      // криптографически стойкое значение в диапазоне [100000, 1000000).
      const code = String(randomInt(100000, 1000000));
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

      const deliveryResult = await transport.deliver({
        channel: input.provider,
        recipientContact: target,
        subject: "Your Simple Dimple verification code",
        message: `Your verification code is ${code}. It expires in 10 minutes.`,
        idempotencyKey: challenge.id
      });

      if (deliveryResult.deliveryPath === "local_dev_outbox") {
        console.info(
          `[auth-challenge] transport not configured, dev fallback: challengeId=${challenge.id} target=${target} code=${code}`
        );
      } else if (deliveryResult.status === "failed") {
        throw new StoreAuthError("Failed to deliver verification code", 502);
      }

      return {
        challengeId: challenge.id,
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
        // Считаем неверные попытки на конкретный challenge. Единственной защитой
        // раньше был глобальный IP rate limit, чего мало против перебора 6-значного
        // кода. Исчерпав лимит, гасим challenge — нужен новый код.
        const nextAttempts = challenge.attempts + 1;
        const attemptsExhausted = nextAttempts >= maxVerificationAttempts;

        await prisma.verificationChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: nextAttempts,
            status: attemptsExhausted ? VerificationChallengeStatus.expired : challenge.status
          }
        });

        if (attemptsExhausted) {
          throw new StoreAuthError("Too many invalid attempts, request a new verification code", 429);
        }

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

    async logout(sessionId?: string | null): Promise<AuthSessionSummary> {
      const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";

      if (!trimmedSessionId) {
        return cloneDefaultAuthSession();
      }

      const existing = await prisma.authSession.findUnique({
        where: { id: trimmedSessionId }
      });

      if (!existing) {
        return cloneDefaultAuthSession();
      }

      const revokedAt = new Date();
      await prisma.authSession.update({
        where: { id: trimmedSessionId },
        data: {
          status: AuthSessionStatus.revoked,
          revokedAt
        }
      });

      return normalizeAuthSession({
        id: existing.id,
        userId: existing.userId,
        provider: existing.provider,
        status: "revoked",
        isAuthenticated: false,
        lastAuthenticatedAt: existing.lastAuthenticatedAt?.toISOString() ?? revokedAt.toISOString(),
        expiresAt: existing.expiresAt?.toISOString() ?? null
      });
    }
  };
}

// Re-export for backward compatibility with normalizeVerificationTarget usage
import { normalizeVerificationTarget } from "./utils.js";
