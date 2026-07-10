import type { PrismaClient } from "../generated/prisma/client.js";
import type { EndpointHealthCheckResult, EndpointHealthCheckTarget } from "../endpoint-healthcheck.js";

const deactivateAfterConsecutiveFailures = 3;

export function createEndpointHealthCheckStore(prisma: PrismaClient) {
  return {
    async listCheckableEndpoints(): Promise<EndpointHealthCheckTarget[]> {
      const endpoints = await prisma.endpoint.findMany({
        where: {
          transportConfig: { isNot: null }
        },
        select: {
          id: true,
          ipAddress: true,
          transportConfig: { select: { port: true } }
        }
      });

      return endpoints
        .filter((endpoint) => endpoint.transportConfig !== null)
        .map((endpoint) => ({
          endpointId: endpoint.id,
          ipAddress: endpoint.ipAddress,
          port: endpoint.transportConfig!.port
        }));
    },

    async applyHealthCheckResult(result: EndpointHealthCheckResult): Promise<void> {
      const endpoint = await prisma.endpoint.findUnique({
        where: { id: result.endpointId },
        select: { isActive: true, consecutiveHealthFailures: true, retiredReason: true }
      });

      if (!endpoint) {
        return;
      }

      // Администратор явно вывел эту ноду из ротации (Ops "Retire") —
      // успешный пинг не должен молча возвращать её в строй за его спиной.
      // Метрики всё равно обновляем, чтобы в Ops было видно "уже отвечает,
      // можно реактивировать вручную", но isActive/retiredAt/retiredReason
      // не трогаем.
      const isManuallyRetired = !endpoint.isActive && endpoint.retiredReason === "manual";

      if (result.ok) {
        await prisma.endpoint.update({
          where: { id: result.endpointId },
          data: {
            isActive: isManuallyRetired ? false : true,
            lastHealthCheckAt: new Date(),
            lastHealthCheckOk: true,
            lastHealthCheckLatencyMs: result.latencyMs,
            consecutiveHealthFailures: isManuallyRetired ? endpoint.consecutiveHealthFailures : 0,
            ...(isManuallyRetired ? {} : { retiredAt: null, retiredReason: null }),
            // measured latency drives both display and the baseline (no-ranking-yet)
            // ordering in listServers(), so the fastest reachable endpoint wins by default
            ...(typeof result.latencyMs === "number" ? { latencyMs: result.latencyMs } : {})
          }
        });
        return;
      }

      if (isManuallyRetired) {
        // Уже вне ротации по решению администратора — не нужно наращивать
        // failure streak или трогать retire-аудит из-за того, что нода (и
        // так выключенная) не отвечает.
        await prisma.endpoint.update({
          where: { id: result.endpointId },
          data: {
            lastHealthCheckAt: new Date(),
            lastHealthCheckOk: false,
            lastHealthCheckLatencyMs: null
          }
        });
        return;
      }

      const nextFailureCount = endpoint.consecutiveHealthFailures + 1;
      const shouldDeactivate = nextFailureCount >= deactivateAfterConsecutiveFailures;

      await prisma.endpoint.update({
        where: { id: result.endpointId },
        data: {
          isActive: shouldDeactivate ? false : endpoint.isActive,
          lastHealthCheckAt: new Date(),
          lastHealthCheckOk: false,
          lastHealthCheckLatencyMs: null,
          consecutiveHealthFailures: nextFailureCount,
          ...(shouldDeactivate && endpoint.isActive
            ? { retiredAt: new Date(), retiredReason: "auto_health_failure" }
            : {})
        }
      });

      if (shouldDeactivate && endpoint.isActive) {
        console.warn(
          `[endpoint-healthcheck] deactivating endpoint ${result.endpointId} after ${nextFailureCount} consecutive failures (${result.error ?? "unknown error"}); route policy will fall back to remaining active endpoints`
        );
      }
    }
  };
}
