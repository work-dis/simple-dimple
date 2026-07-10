import "dotenv/config";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { FastifyError } from "fastify";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConnectionRoutes } from "./routes/connection.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOpsAlertRoutes } from "./routes/ops-alerts.js";
import { registerOpsReprobeRoutes } from "./routes/ops-reprobe.js";
import { registerSessionRoutes } from "./routes/session.js";
import { createStateLock } from "./routes/state-lock.js";
import { registerTelemetryRoutes } from "./routes/telemetry.js";
import { createBackendRuntime } from "./runtime.js";

const runtime = createBackendRuntime(process.env.DATABASE_URL);

const app = Fastify({
  logger: true
});

// CORS origin берётся из CORS_ALLOWED_ORIGINS (список через запятую). Если переменная
// не задана, оставляем reflect-all (origin: true) для локального dev — прод обязан
// задать явный allowlist. См. DECISIONS.md, Decision 022.
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

await app.register(cors, {
  origin: corsAllowedOrigins.length > 0 ? corsAllowedOrigins : true
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute"
});

app.addHook("onClose", async () => {
  await runtime.disconnect();
});

// Fastify/ajv schema validation (см. route-схемы в schemas.ts) отклоняет
// запрос до хендлера, но по умолчанию отвечает {statusCode, error: "Bad
// Request", message}. Приводим к тому же {error: string} контракту, что и
// остальные ручные 400-ки в route-модулях.
app.setErrorHandler<FastifyError>((error, _request, reply) => {
  if (error.validation) {
    reply.code(400);
    return {
      error: error.message
    };
  }

  reply.send(error);
});

// Per-user connection-state (session status/activeServerId) мутируется из
// трёх разных роутов (/api/connect, /api/server, /api/account/profile) —
// один общий lock, чтобы конкурентные запросы одного юзера не гонялись.
const stateLock = createStateLock();

registerHealthRoutes(app);
registerSessionRoutes(app, runtime);
registerAuthRoutes(app, runtime);
registerTelemetryRoutes(app, runtime);
registerOpsReprobeRoutes(app, runtime);
registerOpsAlertRoutes(app, runtime);
registerAdminRoutes(app, runtime);
registerAccountRoutes(app, runtime, stateLock);
registerConnectionRoutes(app, runtime, stateLock);

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
