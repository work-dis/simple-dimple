import type { FastifyInstance } from "fastify";
import type { BackendRuntime } from "../runtime.js";
import type {
  LoginWithPasswordBody,
  RegisterWithPasswordBody,
  RequestAuthChallengeBody,
  VerifyAuthChallengeBody
} from "../types.js";
import { getRequestAuthContext, isStatusCodeError, replyWithStatusCodeError } from "./context.js";

export function registerAuthRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  app.get("/api/auth/session", async (request) => {
    const context = await getRequestAuthContext(runtime, request);
    return {
      auth: context.auth
    };
  });

  app.post<{ Body: LoginWithPasswordBody }>("/api/auth/login", async (request, reply) => {
    const login = request.body?.login?.trim();
    const password = request.body?.password;

    if (!login || !password) {
      reply.code(400);
      return {
        error: "Login and password are required"
      };
    }

    try {
      const result = await store.loginWithPassword({
        login,
        password
      });
      return {
        auth: result.auth,
        account: result.account
      };
    } catch (error) {
      if (isStatusCodeError(error)) {
        return replyWithStatusCodeError(reply, error);
      }

      throw error;
    }
  });

  app.post<{ Body: RegisterWithPasswordBody }>("/api/auth/register", async (request, reply) => {
    const login = request.body?.login?.trim();
    const password = request.body?.password;

    if (!login || !password) {
      reply.code(400);
      return {
        error: "Login and password are required"
      };
    }

    if (login.length < 3) {
      reply.code(400);
      return {
        error: "Login must contain at least 3 characters"
      };
    }

    if (password.length < 6) {
      reply.code(400);
      return {
        error: "Password must contain at least 6 characters"
      };
    }

    const displayName = request.body?.displayName?.trim() || login;

    try {
      const result = await store.registerWithPassword({
        login,
        password,
        displayName
      });
      return {
        auth: result.auth,
        account: result.account
      };
    } catch (error) {
      if (isStatusCodeError(error)) {
        return replyWithStatusCodeError(reply, error);
      }

      throw error;
    }
  });

  app.post<{ Body: RequestAuthChallengeBody }>("/api/auth/challenge", async (request, reply) => {
    const provider = request.body?.provider;
    const target = request.body?.target?.trim();

    if ((provider !== "email" && provider !== "telegram") || !target) {
      reply.code(400);
      return {
        error: "Verification provider and target are required"
      };
    }

    try {
      const challenge = await store.requestAuthChallenge({
        provider,
        target
      });

      return {
        challenge
      };
    } catch (error) {
      if (isStatusCodeError(error)) {
        return replyWithStatusCodeError(reply, error);
      }

      throw error;
    }
  });

  app.post<{ Body: VerifyAuthChallengeBody }>("/api/auth/verify", async (request, reply) => {
    const challengeId = request.body?.challengeId?.trim();
    const code = request.body?.code?.trim();
    const displayName = request.body?.displayName?.trim() ?? "";

    if (!challengeId || !code) {
      reply.code(400);
      return {
        error: "Challenge id and code are required"
      };
    }

    try {
      const result = await store.verifyAuthChallenge({
        challengeId,
        code,
        displayName
      });
      return {
        auth: result.auth,
        account: result.account
      };
    } catch (error) {
      if (isStatusCodeError(error)) {
        return replyWithStatusCodeError(reply, error);
      }

      throw error;
    }
  });

  app.post("/api/auth/logout", async (request) => {
    const context = await getRequestAuthContext(runtime, request);
    const rawSessionId = request.headers["x-auth-session-id"];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    const auth = await store.logout(sessionId ?? context.auth.id);

    return {
      auth
    };
  });

  app.get("/api/account", async (request, reply) => {
    const context = await getRequestAuthContext(runtime, request);
    if (!context.auth.isAuthenticated) {
      reply.code(401);
      return {
        error: "Authentication required"
      };
    }

    return {
      account: context.account
    };
  });
}
