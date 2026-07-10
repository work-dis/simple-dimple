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
    <div className={`serverButton alertCard severity-${alert.severity}`}>
      {/* Info block: severity/status, title, detail, and secondary metadata —
          nothing clickable lives in here. */}
      <div className="alertHeader">
        <span className={`severityBadge ${formatAlertSeverity(alert.severity)}`}>
          {formatAlertSeverity(alert.severity)}
        </span>
        <span className={`alertStatusBadge ${formatPersistedAlertStatus(alert.status)}`}>
          {formatPersistedAlertStatus(alert.status)}
        </span>
        <strong className="alertTitle">{alert.title}</strong>
      </div>
      <p className="alertDetail">{alert.detail}</p>
      {alert.severity === "watch" ? (
        <p className="alertDetail">Delivery path: shared watch digest batch.</p>
      ) : null}

      {inventoryAlertMetadata ? (
        <div className="alertMeta">
          <small>
            Inventory · endpoints {inventoryAlertMetadata.activeInventoryEndpoints ?? "—"} · providers{" "}
            {inventoryAlertMetadata.distinctInventoryProviders ?? "—"} · ASN{" "}
            {inventoryAlertMetadata.distinctInventoryAsns ?? "—"} · regions{" "}
            {inventoryAlertMetadata.distinctInventoryRegions ?? "—"}
          </small>
          <small>
            Policy target {inventoryAlertMetadata.minimumRecommendedFailureDomains ?? "—"} ·{" "}
            {inventoryAlertMetadata.inventoryFailedDimensions.length
              ? inventoryAlertMetadata.inventoryFailedDimensions.join(" · ")
              : "Policy satisfied"}
          </small>
        </div>
      ) : null}

      <div className="alertMeta">
        <small>
          Started {formatDateTime(alert.startedAt)} · last detected {formatDateTime(alert.lastDetectedAt)}
        </small>
        <small>
          Acknowledged {formatDateTime(alert.acknowledgedAt)} · snoozed until {formatDateTime(alert.snoozedUntil)}
        </small>
        <small>Dedupe key · {alert.dedupeKey}</small>
      </div>

      {/* Actions block: every button that mutates this alert's state, grouped
          apart from the info above by a divider so nothing reads as "loose". */}
      <div className="alertActions">
        <span className="alertActionsLabel">Investigate</span>
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
      </div>
      <div className="alertActions">
        <span className="alertActionsLabel">Manage</span>
        {alert.severity === "critical" ? (
          <button
            className="ghostButton primaryGhostButton"
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
        <div className="alertSubPanel">
          <h4>Escalation preview</h4>
          <small>
            Escalation {escalationPreview.escalationLevel} · {escalationPreview.shouldEscalate ? "send" : "hold"} ·{" "}
            recipients {escalationPreview.recipients.length}
          </small>
          <small>Subject · {escalationPreview.recommendedSubject}</small>
          <small>Reason · {escalationPreview.reason}</small>
          {escalationMessageLines.map((line, index) => (
            <small key={`${alert.id}-preview-line-${index}`}>
              {index === 0 ? "Title" : line.startsWith("Status:")
                ? "Status"
                : line.startsWith("Severity:")
                  ? "Severity"
                  : line.startsWith("Last detected:")
                    ? "Last detected"
                    : line.startsWith("Escalation:")
                      ? "Escalation"
                      : line.startsWith("Why:")
                        ? "Why"
                        : line.startsWith("Failed dimensions:")
                          ? "Failed dimensions"
                          : line.startsWith("Inventory counts:")
                            ? "Inventory counts"
                            : line.startsWith("Policy target:")
                              ? "Policy target"
                              : index === 1
                                ? "Detail"
                                : "Body"}{" "}
              · {line}
            </small>
          ))}
          {escalationPreview.recipients.map((recipient) => (
            <small key={`${alert.id}-${recipient.userId}-${recipient.channel}`}>
              Step {recipient.chainStep} · {recipient.escalationTier} · {recipient.channel} · {recipient.displayName} ·{" "}
              {recipient.contact}
            </small>
          ))}
        </div>
      ) : null}

      {deliveries.length ? (
        <div className="alertSubPanel">
          <h4>Delivery log</h4>
          <small>
            Recent delivery batch {deliveries[0]?.batchId.slice(0, 8)} · entries {deliveries.length}
          </small>
          {deliveries.map((delivery) => (
            <div className="alertDeliveryEntry" key={delivery.id}>
              <small>
                {delivery.status} · {delivery.channel} · {delivery.deliveryPath} · {delivery.recipientDisplayName} ·{" "}
                {delivery.recipientContact} · {formatDateTime(delivery.deliveredAt ?? delivery.createdAt)}
              </small>
              {delivery.providerMessageId ? <small>Provider message · {delivery.providerMessageId}</small> : null}
              {typeof delivery.metadata.failureReason === "string" ? (
                <small>Failure reason · {delivery.metadata.failureReason}</small>
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
        </div>
      ) : null}
    </div>
  );
}
