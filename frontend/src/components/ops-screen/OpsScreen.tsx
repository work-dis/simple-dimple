import type {
  AdminEndpointSummary,
  AuthSession,
  AccountSummary,
  OpsAlertDeliverySummary,
  OpsAlertEscalationPreview,
  OpsAlertSummary,
  RouteDecisionOpsSummary,
} from "../../types";
import { formatSuccessRate } from "../../lib/formatters";
import { AlertsFeedSection, AttentionSection } from "./AlertsAndAttentionSections";
import { DailyHistorySection, FleetSection, HistorySection } from "./FleetAndHistorySections";
import { FocusedDrilldownSection } from "./FocusedDrilldownSection";
import { WorkerAlertsSection, WorkerExecutionSection, WorkerHotspotsSection } from "./WorkerExecutionSections";
import { FailureDrilldownSection, NetworkHotspotsSection, TimelineSection } from "./NetworkAndTimelineSections";
import { PressureSection, QualityMetricsSection, RecoverySection } from "./QualityAndPressureSections";
import {
  EndpointsSection,
  NetworksSection,
  RecentEventsSection,
  RecentJobsSection,
} from "./JobsEndpointsNetworksEventsSections";

interface Props {
  auth: AuthSession | null;
  account: AccountSummary | null;
  routeDecisionOps: RouteDecisionOpsSummary | null;
  opsAlerts: OpsAlertSummary[];
  opsAlertEscalationPreviews: Record<string, OpsAlertEscalationPreview>;
  opsAlertDeliveries: Record<string, OpsAlertDeliverySummary[]>;
  adminEndpoints: AdminEndpointSummary[];
  isSubmitting: boolean;
  onReload: () => void;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onDeliverAlertDigest: () => Promise<void>;
  onRetireEndpoint: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReactivateEndpoint: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReloadEndpoints: () => Promise<void>;
}

export function OpsScreen({
  auth,
  account,
  routeDecisionOps,
  opsAlerts,
  opsAlertEscalationPreviews,
  opsAlertDeliveries,
  adminEndpoints,
  isSubmitting,
  onReload,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
  onDeliverAlertDigest,
  onRetireEndpoint,
  onReactivateEndpoint,
  onReloadEndpoints,
}: Props) {
  const canView = auth?.isAuthenticated && account?.user.isAdmin;

  return (
    <>
      <h1>Route Ops</h1>
      <p className="hint">
        Сводка по feedback, persisted reprobe trail и explainable quality metrics без ручных запросов в базу.
      </p>

      {canView && routeDecisionOps ? (
        <OpsDashboard
          ops={routeDecisionOps}
          opsAlerts={opsAlerts}
          opsAlertEscalationPreviews={opsAlertEscalationPreviews}
          opsAlertDeliveries={opsAlertDeliveries}
          adminEndpoints={adminEndpoints}
          isSubmitting={isSubmitting}
          onReload={onReload}
          onAcknowledgeAlert={onAcknowledgeAlert}
          onSnoozeAlert={onSnoozeAlert}
          onUnacknowledgeAlert={onUnacknowledgeAlert}
          onLoadEscalationPreview={onLoadEscalationPreview}
          onLoadAlertDeliveries={onLoadAlertDeliveries}
          onDeliverAlert={onDeliverAlert}
          onRetryAlertDelivery={onRetryAlertDelivery}
          onResendAlertDelivery={onResendAlertDelivery}
          onDeliverAlertDigest={onDeliverAlertDigest}
          onRetireEndpoint={onRetireEndpoint}
          onReactivateEndpoint={onReactivateEndpoint}
          onReloadEndpoints={onReloadEndpoints}
        />
      ) : (
        <div className="signedOutCard">
          <strong>
            {!auth?.isAuthenticated
              ? "Нужно войти, чтобы открыть ops-наблюдение."
              : !account?.user.isAdmin
                ? "Этот раздел доступен только администратору."
                : "Загружаем ops-сводку..."}
          </strong>
        </div>
      )}
    </>
  );
}

/* ──────────────── Dashboard ──────────────── */

interface OpsDashboardProps {
  ops: RouteDecisionOpsSummary;
  opsAlerts: OpsAlertSummary[];
  opsAlertEscalationPreviews: Record<string, OpsAlertEscalationPreview>;
  opsAlertDeliveries: Record<string, OpsAlertDeliverySummary[]>;
  adminEndpoints: AdminEndpointSummary[];
  isSubmitting: boolean;
  onReload: () => void;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onDeliverAlertDigest: () => Promise<void>;
  onRetireEndpoint: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReactivateEndpoint: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReloadEndpoints: () => Promise<void>;
}

function OpsDashboard({
  ops,
  opsAlerts,
  opsAlertEscalationPreviews,
  opsAlertDeliveries,
  adminEndpoints,
  isSubmitting,
  onReload,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
  onDeliverAlertDigest,
  onRetireEndpoint,
  onReactivateEndpoint,
  onReloadEndpoints,
}: OpsDashboardProps) {
  return (
    <>
      <div className="details">
        <div>
          <span>Окно наблюдения</span>
          <strong>{ops.windowHours} часов</strong>
        </div>
        <div>
          <span>Всего feedback</span>
          <strong>{ops.totals.feedbackEvents}</strong>
        </div>
        <div>
          <span>Success rate</span>
          <strong>{formatSuccessRate(ops.totals.successRate)}</strong>
        </div>
        <div>
          <span>Connected / unstable / failed</span>
          <strong>
            {ops.totals.connectedCount} / {ops.totals.unstableCount} / {ops.totals.failedCount}
          </strong>
        </div>
        <div>
          <span>Уникальные endpoint-ы</span>
          <strong>{ops.totals.uniqueEndpoints}</strong>
        </div>
        <div>
          <span>Уникальные сети</span>
          <strong>{ops.totals.uniqueNetworks}</strong>
        </div>
        <div>
          <span>Срез собран</span>
          <strong>{new Date(ops.generatedAt).toLocaleString("ru-RU")}</strong>
        </div>
      </div>

      <AlertsFeedSection
        opsAlerts={opsAlerts}
        opsAlertEscalationPreviews={opsAlertEscalationPreviews}
        opsAlertDeliveries={opsAlertDeliveries}
        isSubmitting={isSubmitting}
        onReload={onReload}
        onDeliverAlertDigest={onDeliverAlertDigest}
        onAcknowledgeAlert={onAcknowledgeAlert}
        onSnoozeAlert={onSnoozeAlert}
        onUnacknowledgeAlert={onUnacknowledgeAlert}
        onLoadEscalationPreview={onLoadEscalationPreview}
        onLoadAlertDeliveries={onLoadAlertDeliveries}
        onDeliverAlert={onDeliverAlert}
        onRetryAlertDelivery={onRetryAlertDelivery}
        onResendAlertDelivery={onResendAlertDelivery}
      />

      <AttentionSection operationalSummary={ops.operationalSummary} />

      <FleetSection
        adminEndpoints={adminEndpoints}
        isSubmitting={isSubmitting}
        onRetireEndpoint={onRetireEndpoint}
        onReactivateEndpoint={onReactivateEndpoint}
        onReloadEndpoints={onReloadEndpoints}
      />

      <HistorySection history={ops.operationalSummary.history} />

      <DailyHistorySection dailyHistory={ops.operationalSummary.dailyHistory} />

      <FocusedDrilldownSection
        focusedDrilldowns={ops.routeReprobeExecution.focusedDrilldowns}
        generatedAt={ops.generatedAt}
      />

      <WorkerExecutionSection execution={ops.routeReprobeExecution} />

      <WorkerAlertsSection workerAlerts={ops.routeReprobeExecution.workerAlerts} />

      <WorkerHotspotsSection workerHotspots={ops.routeReprobeExecution.workerHotspots} />

      <NetworkHotspotsSection
        networkHotspots={ops.routeReprobeExecution.networkHotspots}
        generatedAt={ops.generatedAt}
      />

      <FailureDrilldownSection failureDrilldown={ops.routeReprobeExecution.failureDrilldown} />

      <TimelineSection timeline={ops.routeReprobeExecution.timeline} />

      <QualityMetricsSection qualityMetrics={ops.qualityMetrics} />

      <PressureSection
        providerPressure={ops.qualityMetrics.providerPressure}
        asnPressure={ops.qualityMetrics.asnPressure}
      />

      <RecoverySection recoveryByFailureDomain={ops.qualityMetrics.recoveryByFailureDomain} />

      <RecentJobsSection recentJobs={ops.routeReprobeExecution.recentJobs} />

      <EndpointsSection endpoints={ops.endpoints} />

      <NetworksSection networks={ops.networks} />

      <RecentEventsSection recentEvents={ops.recentEvents} isSubmitting={isSubmitting} onReload={onReload} />
    </>
  );
}
