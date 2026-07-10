import type {
  OpsAlertDeliverySummary,
  OpsAlertEscalationPreview,
  OpsAlertSummary,
  RouteDecisionOpsSummary,
} from "../../types";
import { formatInventoryFailedDimensions } from "../../lib/formatters";
import { PersistedAlertTile } from "./PersistedAlertTile";
import { formatAlertSeverity, formatOperationalSeverity, formatInventoryRisk } from "./formatters";

export function AlertsFeedSection({
  opsAlerts,
  opsAlertEscalationPreviews,
  opsAlertDeliveries,
  isSubmitting,
  onReload,
  onDeliverAlertDigest,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
}: {
  opsAlerts: OpsAlertSummary[];
  opsAlertEscalationPreviews: Record<string, OpsAlertEscalationPreview>;
  opsAlertDeliveries: Record<string, OpsAlertDeliverySummary[]>;
  isSubmitting: boolean;
  onReload: () => void;
  onDeliverAlertDigest: () => Promise<void>;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
}) {
  const watchAlerts = opsAlerts.filter((alert) => alert.severity === "watch");

  return (
    <div className="opsSection">
      <div className="opsHeaderRow">
        <h2>Persisted alerts feed</h2>
        <div className="opsActionRow">
          {watchAlerts.length ? (
            <button className="ghostButton" onClick={() => void onDeliverAlertDigest()} disabled={isSubmitting}>
              Send watch digest
            </button>
          ) : null}
          <button className="ghostButton" onClick={onReload} disabled={isSubmitting}>
            Refresh feed
          </button>
        </div>
      </div>
      {watchAlerts.length ? (
        <p className="hint">
          Watch-level alerts go through one shared digest batch for the current feed, not per-alert delivery.
        </p>
      ) : null}
      <div className="serverList">
        {opsAlerts.length ? (
          opsAlerts.map((alert) => (
            <PersistedAlertTile
              key={alert.id}
              alert={alert}
              escalationPreview={opsAlertEscalationPreviews[alert.id] ?? null}
              deliveries={opsAlertDeliveries[alert.id] ?? []}
              isSubmitting={isSubmitting}
              onAcknowledgeAlert={onAcknowledgeAlert}
              onSnoozeAlert={onSnoozeAlert}
              onUnacknowledgeAlert={onUnacknowledgeAlert}
              onLoadEscalationPreview={onLoadEscalationPreview}
              onLoadAlertDeliveries={onLoadAlertDeliveries}
              onDeliverAlert={onDeliverAlert}
              onRetryAlertDelivery={onRetryAlertDelivery}
              onResendAlertDelivery={onResendAlertDelivery}
            />
          ))
        ) : (
          <div className="serverButton">
            <span>No persisted alerts yet.</span>
            <small>The current ops summary does not materialize active feed items in this observation window.</small>
          </div>
        )}
      </div>
    </div>
  );
}

export function AttentionSection({
  operationalSummary,
}: {
  operationalSummary: RouteDecisionOpsSummary["operationalSummary"];
}) {
  return (
    <div className="opsSection">
      <h2>Attention now</h2>
      <div className="serverList">
        <div className="serverButton">
          <span>Overall severity</span>
          <small>
            {formatOperationalSeverity(operationalSummary.overallSeverity)} · active alerts{" "}
            {operationalSummary.activeAlertCount}
          </small>
          <small>
            inventory {formatInventoryRisk(operationalSummary.inventoryHealth.riskLevel)} · endpoints{" "}
            {operationalSummary.inventoryHealth.activeEndpoints} · providers{" "}
            {operationalSummary.inventoryHealth.distinctProviders} · ASN{" "}
            {operationalSummary.inventoryHealth.distinctAsns}
          </small>
          <small>
            pools {operationalSummary.inventoryHealth.distinctPools} · regional domains{" "}
            {operationalSummary.inventoryHealth.distinctRegions} · biggest cluster{" "}
            {operationalSummary.inventoryHealth.largestRegionalDomainSize}
          </small>
          <small>
            policy target {operationalSummary.inventoryHealth.minimumRecommendedFailureDomains} domains ·{" "}
            {formatInventoryFailedDimensions(operationalSummary.inventoryHealth)}
          </small>
          {operationalSummary.inventoryHealth.policyViolationMessage ? (
            <small>{operationalSummary.inventoryHealth.policyViolationMessage}</small>
          ) : null}
          <small>
            retention jobs {operationalSummary.retention.routeReprobeJobsDays}d · events{" "}
            {operationalSummary.retention.routeEventsDays}d · probes{" "}
            {operationalSummary.retention.probeReportsDays}d
          </small>
          <small>
            rollups {operationalSummary.retention.routeSuccessRollupsDays}d · rankings{" "}
            {operationalSummary.retention.routeRankingsDays}d
          </small>
        </div>
        {operationalSummary.alerts.length ? (
          operationalSummary.alerts.map((alert) => (
            <div className="serverButton" key={alert.id}>
              <span>
                {formatAlertSeverity(alert.severity)} · {alert.title}
              </span>
              <small>{alert.detail}</small>
            </div>
          ))
        ) : (
          <div className="serverButton">
            <span>No active ops alerts.</span>
            <small>Worker execution and route-quality summary look healthy in the current observation window.</small>
          </div>
        )}
      </div>
    </div>
  );
}
