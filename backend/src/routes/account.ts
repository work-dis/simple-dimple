import type { FastifyInstance } from "fastify";
import type { BackendRuntime } from "../runtime.js";
import { trimmedContactLooksLikeEmail } from "../store/utils.js";
import type { UpdateAccountProfileBody } from "../types.js";
import { getRequestAuthContext, requireAuthenticatedUserId } from "./context.js";
import type { StateLock } from "./state-lock.js";

export function registerAccountRoutes(app: FastifyInstance, runtime: BackendRuntime, withStateLock: StateLock) {
  const store = runtime.store;

  app.patch<{ Body: UpdateAccountProfileBody }>("/api/account/profile", async (request, reply) => {
    const context = await getRequestAuthContext(runtime, request);
    const userId = requireAuthenticatedUserId(context, reply);
    if (!userId) {
      return {
        error: "Authentication required"
      };
    }

    return withStateLock(userId, async () => {
      const displayName = request.body?.displayName?.trim();
      const contact = request.body?.contact?.trim();

      if (!displayName || !contact) {
        reply.code(400);
        return {
          error: "Display name and contact are required"
        };
      }

      const contactType = trimmedContactLooksLikeEmail(contact) ? ("email" as const) : ("telegram" as const);
      const nextAccount = {
        ...context.account,
        user: {
          ...context.account.user,
          displayName,
          contact,
          contactType
        }
      };
      await store.updateAccountProfile(userId, { displayName, contact, contactType });

      return {
        account: nextAccount
      };
    });
  });
}
