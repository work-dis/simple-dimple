import { useState } from "react";

import { HttpError, readJson } from "../lib";
import type {
  DeliverOpsAlertDigestResponse,
  DeliverOpsAlertResponse,
  OpsAlertDeliveriesResponse,
  OpsAlertDeliverySummary,
  OpsAlertsResponse,
  OpsAlertEscalationPreview,
  OpsAlertEscalationPreviewResponse,
  OpsAlertSummary,
  RouteDecisionOpsResponse,
  RouteDecisionOpsSummary,
  UpdateOpsAlertResponse,
} from "../types";

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
  const [opsAlerts, setOpsAlerts] = useState<OpsAlertSummary[]>([]);
  const [opsAlertEscalationPreviews, setOpsAlertEscalationPreviews] = useState<
    Record<string, OpsAlertEscalationPreview>
  >({});
  const [opsAlertDeliveries, setOpsAlertDeliveries] = useState<
    Record<string, OpsAlertDeliverySummary[]>
  >({});
  const [isLoading, setIsLoading] = useState(false);

  async function loadRouteDecisionOps() {
    setIsLoading(true);
    try {
      onClearError();
      const [opsData, alertsData] = await Promise.all([
        readJson<RouteDecisionOpsResponse>(
          "/api/ops/route-decisions?windowHours=72&recentLimit=12&summaryLimit=6",
        ),
        readJson<OpsAlertsResponse>(
          "/api/ops/alerts?limit=20&windowHours=72&recentLimit=12&summaryLimit=6",
        ),
      ]);
      setRouteDecisionOps(opsData.ops);
      setOpsAlerts(alertsData.alerts);
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

  async function acknowledgeOpsAlert(alertId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<UpdateOpsAlertResponse>(
        `/api/ops/alerts/${alertId}/acknowledge`,
        {
          method: "POST",
        },
      );
      setOpsAlerts((prev) =>
        prev.map((alert) => (alert.id === data.alert.id ? data.alert : alert)),
      );
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 404
          ? "Alert не найден"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Нужен admin-доступ"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function snoozeOpsAlert(alertId: string, minutes = 60) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<UpdateOpsAlertResponse>(
        `/api/ops/alerts/${alertId}/snooze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes }),
        },
      );
      setOpsAlerts((prev) =>
        prev.map((alert) => (alert.id === data.alert.id ? data.alert : alert)),
      );
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 404
          ? "Alert не найден"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Нужен admin-доступ"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function unacknowledgeOpsAlert(alertId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<UpdateOpsAlertResponse>(
        `/api/ops/alerts/${alertId}/unacknowledge`,
        {
          method: "POST",
        },
      );
      setOpsAlerts((prev) =>
        prev.map((alert) => (alert.id === data.alert.id ? data.alert : alert)),
      );
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 404
          ? "Alert не найден"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Нужен admin-доступ"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function loadOpsAlertEscalationPreview(alertId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<OpsAlertEscalationPreviewResponse>(
        `/api/ops/alerts/${alertId}/escalation-preview`,
      );
      setOpsAlertEscalationPreviews((prev) => ({
        ...prev,
        [alertId]: data.preview,
      }));
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 404
          ? "Alert не найден"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Нужен admin-доступ"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function loadOpsAlertDeliveries(alertId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<OpsAlertDeliveriesResponse>(
        `/api/ops/alerts/${alertId}/deliveries?limit=6`,
      );
      setOpsAlertDeliveries((prev) => ({
        ...prev,
        [alertId]: data.deliveries,
      }));
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 404
          ? "Alert не найден"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Нужен admin-доступ"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function deliverOpsAlert(alertId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<DeliverOpsAlertResponse>(
        `/api/ops/alerts/${alertId}/deliver`,
        {
          method: "POST",
        },
      );
      setOpsAlertEscalationPreviews((prev) => ({
        ...prev,
        [alertId]: data.preview,
      }));
      setOpsAlertDeliveries((prev) => ({
        ...prev,
        [alertId]: data.deliveries,
      }));
    } catch (nextError) {
      onError(
        nextError instanceof HttpError &&
          nextError.status === 409 &&
          nextError.message.includes("cooldown")
          ? "Эта escalation-доставка сейчас удерживается cooldown policy"
          : nextError instanceof HttpError && nextError.status === 409
          ? "Этот alert сейчас не требует immediate-доставки"
          : nextError instanceof HttpError && nextError.status === 404
            ? "Alert не найден"
            : nextError instanceof HttpError && nextError.status === 403
              ? "Нужен admin-доступ"
              : nextError instanceof Error
                ? nextError.message
                : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function deliverOpsAlertDigest() {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<DeliverOpsAlertDigestResponse>(
        "/api/ops/alerts/digest-deliver",
        {
          method: "POST",
        },
      );
      setOpsAlertDeliveries((prev) => {
        const next = { ...prev };

        for (const alert of data.alerts) {
          next[alert.id] = data.deliveries.filter(
            (delivery) => delivery.alertId === alert.id,
          );
        }

        return next;
      });
    } catch (nextError) {
      onError(
        nextError instanceof HttpError &&
          nextError.status === 409 &&
          nextError.message.includes("quiet window")
          ? "Digest batch сейчас удерживается quiet window policy"
          : nextError instanceof HttpError &&
            nextError.status === 409 &&
          nextError.message.includes("digest cadence")
          ? "Digest batch сейчас удерживается digest cadence policy"
          : nextError instanceof HttpError &&
            nextError.status === 409 &&
          nextError.message.includes("cooldown")
          ? "Digest batch сейчас удерживается cooldown policy"
          : nextError instanceof HttpError && nextError.status === 409
          ? "Сейчас нет watch-alerts для digest batch"
          : nextError instanceof HttpError && nextError.status === 403
            ? "Нужен admin-доступ"
            : nextError instanceof Error
              ? nextError.message
              : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function retryOpsAlertDelivery(alertId: string, deliveryId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<OpsAlertDeliveriesResponse>(
        `/api/ops/alerts/${alertId}/deliveries/${deliveryId}/retry`,
        {
          method: "POST",
        },
      );
      setOpsAlertDeliveries((prev) => ({
        ...prev,
        [alertId]: data.deliveries,
      }));
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 409
          ? "Эту delivery-запись сейчас нельзя переотправить"
          : nextError instanceof HttpError && nextError.status === 404
            ? "Alert или delivery не найдены"
            : nextError instanceof HttpError && nextError.status === 403
              ? "Нужен admin-доступ"
              : nextError instanceof Error
                ? nextError.message
                : "Unknown error",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function resendOpsAlertDelivery(alertId: string, deliveryId: string) {
    setIsLoading(true);
    try {
      onClearError();
      const data = await readJson<OpsAlertDeliveriesResponse>(
        `/api/ops/alerts/${alertId}/deliveries/${deliveryId}/resend`,
        {
          method: "POST",
        },
      );
      setOpsAlertDeliveries((prev) => ({
        ...prev,
        [alertId]: data.deliveries,
      }));
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 409
          ? "Эту успешную delivery-запись сейчас нельзя отправить повторно"
          : nextError instanceof HttpError && nextError.status === 404
            ? "Alert или delivery не найдены"
            : nextError instanceof HttpError && nextError.status === 403
              ? "Нужен admin-доступ"
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
    setOpsAlerts([]);
    setOpsAlertEscalationPreviews({});
    setOpsAlertDeliveries({});
  }

  return {
    routeDecisionOps,
    opsAlerts,
    opsAlertEscalationPreviews,
    opsAlertDeliveries,
    isLoading,
    loadRouteDecisionOps,
    acknowledgeOpsAlert,
    snoozeOpsAlert,
    unacknowledgeOpsAlert,
    loadOpsAlertEscalationPreview,
    loadOpsAlertDeliveries,
    deliverOpsAlert,
    retryOpsAlertDelivery,
    resendOpsAlertDelivery,
    deliverOpsAlertDigest,
    clearRouteDecisionOps,
  };
}
