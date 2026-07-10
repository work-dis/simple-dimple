import { useState } from "react";

import { HttpError, readJson } from "../lib";
import type {
  AdminEndpointSummary,
  AdminEndpointsResponse,
  SetAdminEndpointActiveResponse,
} from "../types";

interface UseAdminEndpointsOptions {
  onClearError: () => void;
  onError: (message: string) => void;
}

// Шаг 5 (PRIORITY_PLAN.md) — fleet provisioning: список Xray-нод и ручной
// retire/reactivate из Ops. Регистрация новых нод делается provisioning-
// скриптом (deploy/xray/provision-node.sh) напрямую через API, а не через
// эту форму — сюда выносить register-форму незачем.
export function useAdminEndpoints({ onClearError, onError }: UseAdminEndpointsOptions) {
  const [adminEndpoints, setAdminEndpoints] = useState<AdminEndpointSummary[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadAdminEndpoints() {
    try {
      onClearError();
      const data = await readJson<AdminEndpointsResponse>("/api/admin/endpoints");
      setAdminEndpoints(data.endpoints);
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Нужно войти, чтобы открыть fleet-список"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Этот раздел доступен только администратору"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    }
  }

  async function setEndpointActive(endpoint: AdminEndpointSummary, isActive: boolean) {
    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<SetAdminEndpointActiveResponse>(
        `/api/admin/endpoints/${endpoint.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        },
      );

      setAdminEndpoints((prev) =>
        prev.map((item) => (item.id === data.endpoint.id ? data.endpoint : item)),
      );
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 409
          ? "Retire уронил бы active inventory ниже минимума — сначала добавь замену"
          : nextError instanceof HttpError && nextError.status === 404
            ? "Endpoint не найден"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function retireEndpoint(endpoint: AdminEndpointSummary) {
    await setEndpointActive(endpoint, false);
  }

  async function reactivateEndpoint(endpoint: AdminEndpointSummary) {
    await setEndpointActive(endpoint, true);
  }

  function clearAdminEndpoints() {
    setAdminEndpoints([]);
  }

  return {
    adminEndpoints,
    isSubmitting,
    loadAdminEndpoints,
    retireEndpoint,
    reactivateEndpoint,
    clearAdminEndpoints,
  };
}
