import type {
  OpsAlertDeliverySummary,
  OpsAlertEscalationPreview,
  OpsAlertSummary,
} from "../../types";
import {
  formatAlertSeverity,
  formatDateTime,
  formatPersistedAlertStatus,
  readInventoryAlertMetadata,
} from "./formatters";

export function PersistedAlertTile({
  alert,
  escalationPreview,
  deliveries,
  isSubmitting,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
}: {
  alert: OpsAlertSummary;
  escalationPreview: OpsAlertEscalationPreview | null;
  deliveries: OpsAlertDeliverySummary[];
  isSubmitting: boolean;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
}) {
  const inventoryAlertMetadata = readInventoryAlertMetadata(alert.metadata);
  const escalationMessageLines = escalationPreview
    ? escalationPreview.recommendedMessage
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  return (
    <div className="serverButton">
      <span>
        {formatAlertSeverity(alert.severity)} · {formatPersistedAlertStatus(alert.status)} · {alert.title}
      </span>
      <small>{alert.detail}</small>
      {inventoryAlertMetadata ? (
        <>
          <small>
            inventory counts · endpoints {inventoryAlertMetadata.activeInventoryEndpoints ?? "—"} · providers{" "}
            {inventoryAlertMetadata.distinctInventoryProviders ?? "—"} · ASN{" "}
            {inventoryAlertMetadata.distinctInventoryAsns ?? "—"} · regions{" "}
            {inventoryAlertMetadata.distinctInventoryRegions ?? "—"}
          </small>
          <small>
            policy target {inventoryAlertMetadata.minimumRecommendedFailureDomains ?? "—"} ·{" "}
            {inventoryAlertMetadata.inventoryFailedDimensions.length
              ? inventoryAlertMetadata.inventoryFailedDimensions.join(" · ")
              : "Policy satisfied"}
          </small>
        </>
      ) : null}
      <small>
        started {formatDateTime(alert.startedAt)} · last detected {formatDateTime(alert.lastDetectedAt)}
      </small>
      <small>
        acknowledged {formatDateTime(alert.acknowledgedAt)} · snoozed until {formatDateTime(alert.snoozedUntil)}
      </small>
      <small>
        dedupe {alert.dedupeKey}
      </small>
      {alert.severity === "watch" ? <small>delivery path · shared watch digest batch</small> : null}
      <div className="opsActionRow">
        <button
          className="ghostButton"
          disabled={isSubmitting}
          onClick={() => void onLoadEscalationPreview(alert.id)}
        >
          Preview escalation
        </button>
        <button
          className="ghostButton"
          disabled={isSubmitting}
          onClick={() => void onLoadAlertDeliveries(alert.id)}
        >
          Delivery log
        </button>
        {alert.severity === "critical" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onDeliverAlert(alert.id)}
          >
            Send now
          </button>
        ) : null}
        {alert.status !== "acknowledged" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onAcknowledgeAlert(alert.id)}
          >
            Acknowledge
          </button>
        ) : null}
        {alert.status !== "snoozed" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onSnoozeAlert(alert.id, 60)}
          >
            Snooze 1h
          </button>
        ) : null}
        {alert.status !== "active" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onUnacknowledgeAlert(alert.id)}
          >
            Reopen
          </button>
        ) : null}
      </div>
      {escalationPreview ? (
        <>
          <small>
            escalation {escalationPreview.escalationLevel} · {escalationPreview.shouldEscalate ? "send" : "hold"} ·{" "}
            recipients {escalationPreview.recipients.length}
          </small>
          <small>preview subject · {escalationPreview.recommendedSubject}</small>
          <small>preview reason · {escalationPreview.reason}</small>
          {escalationMessageLines.map((line, index) => (
            <small key={`${alert.id}-preview-line-${index}`}>
              {index === 0 ? "preview title" : line.startsWith("Status:")
                ? "preview status"
                : line.startsWith("Severity:")
                  ? "preview severity"
                  : line.startsWith("Last detected:")
                    ? "preview last detected"
                    : line.startsWith("Escalation:")
                      ? "preview escalation"
                      : line.startsWith("Why:")
                        ? "preview why"
                        : line.startsWith("Failed dimensions:")
                          ? "preview failed dimensions"
                          : line.startsWith("Inventory counts:")
                            ? "preview inventory counts"
                            : line.startsWith("Policy target:")
                              ? "preview policy target"
                              : index === 1
                                ? "preview detail"
                                : "preview body"}{" "}
              · {line}
            </small>
          ))}
          {escalationPreview.recipients.map((recipient) => (
            <small key={`${alert.id}-${recipient.userId}-${recipient.channel}`}>
              step {recipient.chainStep} · {recipient.escalationTier} · {recipient.channel} · {recipient.displayName} · {recipient.contact}
            </small>
          ))}
        </>
      ) : null}
      {deliveries.length ? (
        <>
          <small>
            recent delivery batch {deliveries[0]?.batchId.slice(0, 8)} · entries {deliveries.length}
          </small>
          {deliveries.map((delivery) => (
            <div key={delivery.id}>
              <small>
                {delivery.status} · {delivery.channel} · {delivery.deliveryPath} · {delivery.recipientDisplayName} ·{" "}
                {delivery.recipientContact} · {formatDateTime(delivery.deliveredAt ?? delivery.createdAt)}
              </small>
              {delivery.providerMessageId ? <small>provider message · {delivery.providerMessageId}</small> : null}
              {typeof delivery.metadata.failureReason === "string" ? (
                <small>failure reason · {delivery.metadata.failureReason}</small>
              ) : null}
              {delivery.status === "delivered" ? (
                <div className="opsActionRow">
                  <button
                    className="ghostButton"
                    disabled={isSubmitting}
                    onClick={() => void onResendAlertDelivery(alert.id, delivery.id)}
                  >
                    Send again
                  </button>
                </div>
              ) : null}
              {delivery.status === "failed" ? (
                <div className="opsActionRow">
                  <button
                    className="ghostButton"
                    disabled={isSubmitting}
                    onClick={() => void onRetryAlertDelivery(alert.id, delivery.id)}
                  >
                    Retry failed
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
