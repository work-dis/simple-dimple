import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      ok: true,
      service: "backend",
      checkedAt: new Date().toISOString()
    };
  });
}
