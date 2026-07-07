import { useState } from "react";

import { HttpError, readJson } from "../lib";
import type { RouteDecisionOpsResponse, RouteDecisionOpsSummary } from "../types";

interface UseRouteDecisionOpsOptions {
  onClearError: () => void;
  onError: (message: string) => void;
}

export function useRouteDecisionOps({
  onClearError,
  onError,
}: UseRouteDecisionOpsOptions) {
  const [routeDecisionOps, setRouteDecisionOps] =
    useState<RouteDecisionOpsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function loadRouteDecisionOps() {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<RouteDecisionOpsResponse>(
        "/api/ops/route-decisions?windowHours=72&recentLimit=12&summaryLimit=6",
      );
      setRouteDecisionOps(data.ops);
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Нужно войти, чтобы открыть ops-наблюдение"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Этот раздел доступен только администратору"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function clearRouteDecisionOps() {
    setRouteDecisionOps(null);
  }

  return {
    routeDecisionOps,
    isLoading,
    loadRouteDecisionOps,
    clearRouteDecisionOps,
  };
}
