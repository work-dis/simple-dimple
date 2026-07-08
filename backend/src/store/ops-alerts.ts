import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, OpsAlert, OpsAlertDelivery } from "../generated/prisma/client.js";
import { ContactType, OpsAlertStatus, UserStatus } from "../generated/prisma/client.js";
import type {
  DeliverOpsAlertDigestResponse,
  DeliverOpsAlertResponse,
  OpsAlertDeliveriesResponse,
  OpsAlertDeliverySummary,
  OpsAlertEscalationPreview,
  OpsAlertEscalationRecipient,
  OpsAlertListOptions,
  OpsAlertSummary,
  RouteDecisionOpsSummary,
} from "../types.js";
import { detectOpsAlertsFromSummary } from "./ops-alert-detector.js";
import type { OpsAlertDeliveryTransport } from "./ops-alert-delivery.js";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapOpsAlert(alert: OpsAlert): OpsAlertSummary {
  return {
    id: alert.id,
    alertType: alert.alertType,
    severity: alert.severity,
    status: alert.status,
    dedupeKey: alert.dedupeKey,
    title: alert.title,
    detail: alert.detail,
    metadata: isRecord(alert.metadata) ? alert.metadata : {},
    startedAt: alert.startedAt.toISOString(),
    lastDetectedAt: alert.lastDetectedAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    snoozedUntil: alert.snoozedUntil?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString()
  };
}

function mapOpsAlertDelivery(delivery: OpsAlertDelivery): OpsAlertDeliverySummary {
  return {
    id: delivery.id,
    alertId: delivery.opsAlertId,
    batchId: delivery.batchId,
    channel: delivery.channel,
    escalationLevel:
      delivery.escalationLevel === "immediate" || delivery.escalationLevel === "digest"
        ? delivery.escalationLevel
        : "none",
    status: delivery.status,
    recipientUserId: delivery.recipientUserId ?? null,
    recipientDisplayName: delivery.recipientDisplayName,
    recipientContact: delivery.recipientContact,
    subject: delivery.subject,
    message: delivery.message,
    reason: delivery.reason,
    deliveryPath: delivery.deliveryPath,
    providerMessageId: delivery.providerMessageId ?? null,
    actorUserId: delivery.actorUserId ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    metadata: isRecord(delivery.metadata) ? delivery.metadata : {},
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString()
  };
}

function mapDeliveryChannel(channel: ContactType): "telegram" | "email" {
  return channel === ContactType.telegram ? "telegram" : "email";
}

function toReplayMetadata(
  originalMetadata: unknown,
  input: {
    replayType: "retry" | "resend";
    sourceDeliveryId: string;
    sourceBatchId: string;
    replayBatchId: string;
    replayActorUserId?: string | null;
    replayGroupSize?: number;
    failureReason?: string;
    transport?: Record<string, unknown>;
  }
) {
  const metadata = isRecord(originalMetadata) ? { ...originalMetadata } : {};

  delete metadata.failureReason;
  delete metadata.transport;

  const previousReplayCount = typeof metadata.replayCount === "number" ? metadata.replayCount : 0;
  const previousRetryCount = typeof metadata.retryCount === "number" ? metadata.retryCount : 0;
  const previousResendCount = typeof metadata.resendCount === "number" ? metadata.resendCount : 0;

  return {
    ...metadata,
    replayType: input.replayType,
    replayOfDeliveryId: input.sourceDeliveryId,
    replayOfBatchId: input.sourceBatchId,
    replayBatchId: input.replayBatchId,
    replayCount: previousReplayCount + 1,
    replayTriggeredAt: new Date().toISOString(),
    replayActorUserId: input.replayActorUserId ?? null,
    ...(typeof input.replayGroupSize === "number" ? { replayGroupSize: input.replayGroupSize } : {}),
    ...(input.replayType === "retry"
      ? {
          retryOfDeliveryId: input.sourceDeliveryId,
          retryOfBatchId: input.sourceBatchId,
          retryBatchId: input.replayBatchId,
          retryCount: previousRetryCount + 1,
          retryTriggeredAt: new Date().toISOString(),
          retryActorUserId: input.replayActorUserId ?? null,
          ...(typeof input.replayGroupSize === "number" ? { retryGroupSize: input.replayGroupSize } : {})
        }
      : {
          resendOfDeliveryId: input.sourceDeliveryId,
          resendOfBatchId: input.sourceBatchId,
          resendBatchId: input.replayBatchId,
          resendCount: previousResendCount + 1,
          resendTriggeredAt: new Date().toISOString(),
          resendActorUserId: input.replayActorUserId ?? null,
          ...(typeof input.replayGroupSize === "number" ? { resendGroupSize: input.replayGroupSize } : {})
        }),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    ...(input.transport ? { transport: input.transport } : {})
  };
}

type EscalationAdminRecipientSource = {
  id: string;
  displayName: string;
  contact: string;
  contactType: "telegram" | "email";
  opsAlertImmediateEnabled: boolean;
  opsAlertDigestEnabled: boolean;
  opsAlertEscalationTier: "primary" | "secondary";
};

type EscalationPreviewInput = {
  alert: Pick<OpsAlertSummary, "id" | "status" | "severity" | "title" | "detail" | "lastDetectedAt" | "metadata">;
  recipients: EscalationAdminRecipientSource[];
  now?: Date;
};

function readInventoryAlertMetadata(metadata: Record<string, unknown>) {
  const inventoryFailedDimensions = Array.isArray(metadata.inventoryFailedDimensions)
    ? metadata.inventoryFailedDimensions.filter((value): value is string => typeof value === "string")
    : [];
  const inventoryPolicyViolationMessage =
    typeof metadata.inventoryPolicyViolationMessage === "string" ? metadata.inventoryPolicyViolationMessage : null;
  const activeInventoryEndpoints =
    typeof metadata.activeInventoryEndpoints === "number" ? metadata.activeInventoryEndpoints : null;
  const distinctInventoryProviders =
    typeof metadata.distinctInventoryProviders === "number" ? metadata.distinctInventoryProviders : null;
  const distinctInventoryAsns =
    typeof metadata.distinctInventoryAsns === "number" ? metadata.distinctInventoryAsns : null;
  const distinctInventoryRegions =
    typeof metadata.distinctInventoryRegions === "number" ? metadata.distinctInventoryRegions : null;
  const minimumRecommendedFailureDomains =
    typeof metadata.minimumRecommendedFailureDomains === "number" ? metadata.minimumRecommendedFailureDomains : null;

  if (
    inventoryFailedDimensions.length === 0 &&
    inventoryPolicyViolationMessage === null &&
    activeInventoryEndpoints === null &&
    distinctInventoryProviders === null &&
    distinctInventoryAsns === null &&
    distinctInventoryRegions === null &&
    minimumRecommendedFailureDomains === null
  ) {
    return null;
  }

  return {
    inventoryFailedDimensions,
    inventoryPolicyViolationMessage,
    activeInventoryEndpoints,
    distinctInventoryProviders,
    distinctInventoryAsns,
    distinctInventoryRegions,
    minimumRecommendedFailureDomains
  };
}

function buildOpsAlertInventoryContext(metadata: Record<string, unknown>) {
  const inventoryAlertMetadata = readInventoryAlertMetadata(metadata);

  if (!inventoryAlertMetadata) {
    return null;
  }

  return [
    inventoryAlertMetadata.inventoryPolicyViolationMessage,
    inventoryAlertMetadata.inventoryFailedDimensions.length > 0
      ? `Failed dimensions: ${inventoryAlertMetadata.inventoryFailedDimensions.join(", ")}`
      : null,
    inventoryAlertMetadata.activeInventoryEndpoints !== null ||
    inventoryAlertMetadata.distinctInventoryProviders !== null ||
    inventoryAlertMetadata.distinctInventoryAsns !== null ||
    inventoryAlertMetadata.distinctInventoryRegions !== null
      ? `Inventory counts: endpoints ${inventoryAlertMetadata.activeInventoryEndpoints ?? "—"}, providers ${inventoryAlertMetadata.distinctInventoryProviders ?? "—"}, ASNs ${inventoryAlertMetadata.distinctInventoryAsns ?? "—"}, regions ${inventoryAlertMetadata.distinctInventoryRegions ?? "—"}`
      : null,
    inventoryAlertMetadata.minimumRecommendedFailureDomains !== null
      ? `Policy target: ${inventoryAlertMetadata.minimumRecommendedFailureDomains} independent failure domains`
      : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function buildAlertMessageBody(alert: Pick<OpsAlertSummary, "detail" | "metadata" | "status" | "severity" | "lastDetectedAt">) {
  const inventoryContext = buildOpsAlertInventoryContext(alert.metadata);

  return (
    `${alert.detail.trim()}\n\n` +
    `${inventoryContext ? `${inventoryContext}\n\n` : ""}` +
    `Status: ${alert.status}\n` +
    `Severity: ${alert.severity}\n` +
    `Last detected: ${alert.lastDetectedAt}`
  );
}

function buildDigestSubject(alertCount: number) {
  return `[digest/watch] ${alertCount} ops alerts need follow-up`;
}

function buildDigestMessage(alerts: OpsAlertSummary[]) {
  return [
    "Watch-level ops digest",
    "",
    `Included alerts: ${alerts.length}`,
    ...alerts.flatMap((alert, index) => ["", `${index + 1}. ${alert.title}`, buildAlertMessageBody(alert)])
  ].join("\n");
}

export function buildOpsAlertEscalationPreview(input: EscalationPreviewInput): OpsAlertEscalationPreview {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const alertTitle = input.alert.title.trim();

  let escalationLevel: OpsAlertEscalationPreview["escalationLevel"] = "none";
  let shouldEscalate = false;
  let reason = "Alert does not currently require external escalation.";

  if (input.alert.status === "resolved") {
    reason = "Alert is already resolved, so external escalation is not needed.";
  } else if (input.alert.status === "snoozed") {
    reason = "Alert is snoozed, so escalation should stay paused until the snooze window ends.";
  } else if (input.alert.status === "acknowledged") {
    reason = "Alert is already acknowledged, so escalation can stay inside the current triage flow.";
  } else if (input.alert.severity === "critical") {
    escalationLevel = "immediate";
    shouldEscalate = true;
    reason = "Critical active alert should be delivered immediately to every active admin contact.";
  } else {
    escalationLevel = "digest";
    shouldEscalate = true;
    reason = "Watch-level active alert can be included in the next lightweight admin digest or check-in.";
  }

  const eligibleRecipients = shouldEscalate
    ? input.recipients
        .filter((recipient) =>
          escalationLevel === "immediate" ? recipient.opsAlertImmediateEnabled : recipient.opsAlertDigestEnabled
        )
        .sort((left, right) => {
          if (left.opsAlertEscalationTier === right.opsAlertEscalationTier) {
            return left.displayName.localeCompare(right.displayName);
          }

          return left.opsAlertEscalationTier === "primary" ? -1 : 1;
        })
    : [];
  const recipients: OpsAlertEscalationRecipient[] = eligibleRecipients.map((recipient) => ({
    userId: recipient.id,
    displayName: recipient.displayName,
    contact: recipient.contact,
    channel: recipient.contactType,
    escalationTier: recipient.opsAlertEscalationTier,
    chainStep: recipient.opsAlertEscalationTier === "primary" ? 1 : 2,
    reason:
      escalationLevel === "immediate"
        ? recipient.opsAlertEscalationTier === "primary"
          ? "Primary admin contact for immediate triage of critical alert."
          : "Secondary escalation step if the primary immediate path fails or is unavailable."
        : recipient.opsAlertEscalationTier === "primary"
          ? "Primary digest recipient for watch-level follow-up."
          : "Secondary digest recipient if the primary digest tier is unavailable."
  }));

  const recommendedSubject =
    escalationLevel === "immediate"
      ? `[critical] ${alertTitle}`
      : escalationLevel === "digest"
        ? `[watch] ${alertTitle}`
        : `[info] ${alertTitle}`;
  const recommendedMessage =
    `${alertTitle}\n\n` +
    `${buildAlertMessageBody(input.alert)}\n` +
    `Escalation: ${escalationLevel}\n` +
    `Why: ${reason}`;

  return {
    alertId: input.alert.id,
    alertStatus: input.alert.status,
    alertSeverity: input.alert.severity,
    escalationLevel,
    shouldEscalate,
    reason,
    recipients,
    recommendedSubject,
    recommendedMessage,
    generatedAt
  };
}

type RouteDecisionOpsSummaryLoader = (input?: {
  windowHours?: number;
  recentLimit?: number;
  summaryLimit?: number;
}) => Promise<RouteDecisionOpsSummary>;

type CooldownPolicyInput = {
  alertIds: string[];
  preview: OpsAlertEscalationPreview;
};

function formatCooldownWindow(durationMs: number) {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes < 60) {
    return `${minutes} minute cooldown`;
  }

  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour cooldown`;
}

function parseUtcHour(value: number | undefined, fallback: number) {
  const safeValue = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(Math.max(safeValue, 0), 23);
}

function formatUtcHour(hour: number) {
  return `${hour.toString().padStart(2, "0")}:00 UTC`;
}

function isHourInsideWindow(hour: number, startHourUtc: number, endHourUtc: number) {
  if (startHourUtc === endHourUtc) {
    return true;
  }

  if (startHourUtc < endHourUtc) {
    return hour >= startHourUtc && hour < endHourUtc;
  }

  return hour >= startHourUtc || hour < endHourUtc;
}

export function createOpsAlertStore(
  prisma: PrismaClient,
  deps: {
    getRouteDecisionOpsSummary: RouteDecisionOpsSummaryLoader;
    deliveryTransport: OpsAlertDeliveryTransport;
    immediateDeliveryCooldownMs?: number;
    digestDeliveryCooldownMs?: number;
    digestCadenceMs?: number;
    digestWindowStartHourUtc?: number;
    digestWindowEndHourUtc?: number;
    now?: () => Date;
  }
) {
  const immediateDeliveryCooldownMs = Math.max(0, deps.immediateDeliveryCooldownMs ?? 15 * 60_000);
  const digestDeliveryCooldownMs = Math.max(0, deps.digestDeliveryCooldownMs ?? 6 * 60 * 60_000);
  const digestCadenceMs = Math.max(0, deps.digestCadenceMs ?? 12 * 60 * 60_000);
  const digestWindowStartHourUtc = parseUtcHour(deps.digestWindowStartHourUtc, 7);
  const digestWindowEndHourUtc = parseUtcHour(deps.digestWindowEndHourUtc, 23);
  const getNow = deps.now ?? (() => new Date());

  async function loadAlertOrThrow(alertId: string) {
    const alert = await prisma.opsAlert.findUnique({
      where: {
        id: alertId
      }
    });

    if (!alert) {
      throw new Error("Ops alert not found");
    }

    return alert;
  }

  async function loadEscalationRecipients() {
    const adminUsers = await prisma.user.findMany({
      where: {
        isAdmin: true,
        status: {
          not: UserStatus.blocked
        }
      },
      select: {
        id: true,
        displayName: true,
        contact: true,
        contactType: true
        ,
        opsAlertImmediateEnabled: true,
        opsAlertDigestEnabled: true,
        opsAlertEscalationTier: true
      },
      orderBy: [
        {
          memberSince: "asc"
        }
      ]
    });

    return adminUsers
      .filter((user) => user.contact.trim().length > 0)
      .map((user) => ({
        id: user.id,
        displayName: user.displayName,
        contact: user.contact,
        contactType: user.contactType === ContactType.telegram ? ("telegram" as const) : ("email" as const),
        opsAlertImmediateEnabled: user.opsAlertImmediateEnabled,
        opsAlertDigestEnabled: user.opsAlertDigestEnabled,
        opsAlertEscalationTier: user.opsAlertEscalationTier === "secondary" ? ("secondary" as const) : ("primary" as const)
      }));
  }

  async function loadDeliveryOrThrow(alertId: string, deliveryId: string) {
    const delivery = await prisma.opsAlertDelivery.findUnique({
      where: {
        id: deliveryId
      }
    });

    if (!delivery || delivery.opsAlertId !== alertId) {
      throw new Error("Ops alert delivery not found");
    }

    return delivery;
  }

  async function replayDelivery(
    alertId: string,
    deliveryId: string,
    actorUserId: string | null | undefined,
    mode: "retry" | "resend"
  ): Promise<OpsAlertDeliveriesResponse["deliveries"]> {
    await loadAlertOrThrow(alertId);
    const sourceDelivery = await loadDeliveryOrThrow(alertId, deliveryId);

    if (mode === "retry" && sourceDelivery.status !== "failed") {
      throw new Error("Only failed ops alert deliveries can be retried manually");
    }

    if (mode === "resend" && sourceDelivery.status !== "delivered") {
      throw new Error("Only delivered ops alert deliveries can be resent manually");
    }

    const replayBatchId = randomUUID();

    if (sourceDelivery.escalationLevel === "digest") {
      const sourceBatchDeliveries = await prisma.opsAlertDelivery.findMany({
        where: {
          batchId: sourceDelivery.batchId,
          channel: sourceDelivery.channel,
          recipientContact: sourceDelivery.recipientContact
        },
        orderBy: [
          {
            createdAt: "asc"
          }
        ]
      });

      if (sourceBatchDeliveries.length === 0) {
        throw new Error(`Ops alert digest batch could not be reconstructed for ${mode}`);
      }

      const batchRoot = sourceBatchDeliveries[0] ?? sourceDelivery;
      const deliveryResult = await deps.deliveryTransport.deliver({
        alertId: batchRoot.opsAlertId,
        batchId: replayBatchId,
        channel: mapDeliveryChannel(batchRoot.channel),
        recipientDisplayName: batchRoot.recipientDisplayName,
        recipientContact: batchRoot.recipientContact,
        subject: batchRoot.subject,
        message: batchRoot.message
      });

      await prisma.$transaction(async (tx) => {
        for (const entry of sourceBatchDeliveries) {
          await tx.opsAlertDelivery.create({
            data: {
              id: randomUUID(),
              opsAlertId: entry.opsAlertId,
              batchId: replayBatchId,
              channel: entry.channel,
              escalationLevel: entry.escalationLevel,
              status: deliveryResult.status,
              recipientUserId: entry.recipientUserId,
              recipientDisplayName: entry.recipientDisplayName,
              recipientContact: entry.recipientContact,
              subject: entry.subject,
              message: entry.message,
              reason: deliveryResult.failureReason ?? entry.reason,
              deliveryPath: deliveryResult.deliveryPath,
              providerMessageId: deliveryResult.providerMessageId,
              actorUserId: actorUserId ?? null,
              deliveredAt: deliveryResult.deliveredAt,
              metadata: asJson(
                toReplayMetadata(entry.metadata, {
                  replayType: mode,
                  sourceDeliveryId: entry.id,
                  sourceBatchId: entry.batchId,
                  replayBatchId,
                  replayActorUserId: actorUserId,
                  replayGroupSize: sourceBatchDeliveries.length,
                  failureReason: deliveryResult.failureReason,
                  transport: deliveryResult.metadata
                })
              )
            }
          });
        }
      });

      return listDeliveriesInternal(alertId, 20);
    }

    const deliveryResult = await deps.deliveryTransport.deliver({
      alertId: sourceDelivery.opsAlertId,
      batchId: replayBatchId,
      channel: mapDeliveryChannel(sourceDelivery.channel),
      recipientDisplayName: sourceDelivery.recipientDisplayName,
      recipientContact: sourceDelivery.recipientContact,
      subject: sourceDelivery.subject,
      message: sourceDelivery.message
    });

    await prisma.opsAlertDelivery.create({
      data: {
        id: randomUUID(),
        opsAlertId: sourceDelivery.opsAlertId,
        batchId: replayBatchId,
        channel: sourceDelivery.channel,
        escalationLevel: sourceDelivery.escalationLevel,
        status: deliveryResult.status,
        recipientUserId: sourceDelivery.recipientUserId,
        recipientDisplayName: sourceDelivery.recipientDisplayName,
        recipientContact: sourceDelivery.recipientContact,
        subject: sourceDelivery.subject,
        message: sourceDelivery.message,
        reason: deliveryResult.failureReason ?? sourceDelivery.reason,
        deliveryPath: deliveryResult.deliveryPath,
        providerMessageId: deliveryResult.providerMessageId,
        actorUserId: actorUserId ?? null,
        deliveredAt: deliveryResult.deliveredAt,
        metadata: asJson(
          toReplayMetadata(sourceDelivery.metadata, {
            replayType: mode,
            sourceDeliveryId: sourceDelivery.id,
            sourceBatchId: sourceDelivery.batchId,
            replayBatchId,
            replayActorUserId: actorUserId,
            replayGroupSize: 1,
            failureReason: deliveryResult.failureReason,
            transport: deliveryResult.metadata
          })
        )
      }
    });

    return listDeliveriesInternal(alertId, 20);
  }

  function groupRecipientsByChainStep(recipients: OpsAlertEscalationRecipient[]) {
    const primary = recipients.filter((recipient) => recipient.chainStep === 1);
    const secondary = recipients.filter((recipient) => recipient.chainStep === 2);
    return [primary, secondary].filter((group) => group.length > 0);
  }

  async function loadDigestEligibleAlerts() {
    const alerts = await prisma.opsAlert.findMany({
      where: {
        severity: "watch",
        status: "active"
      },
      orderBy: [
        {
          lastDetectedAt: "desc"
        },
        {
          updatedAt: "desc"
        }
      ],
      take: 50
    });

    return alerts.map(mapOpsAlert);
  }

  async function applyDeliveryCooldownPolicy(input: CooldownPolicyInput): Promise<OpsAlertEscalationPreview> {
    if (!input.preview.shouldEscalate || input.preview.recipients.length === 0 || input.preview.escalationLevel === "none") {
      return input.preview;
    }

    const cooldownMs =
      input.preview.escalationLevel === "immediate" ? immediateDeliveryCooldownMs : digestDeliveryCooldownMs;

    if (cooldownMs <= 0) {
      return input.preview;
    }

    const deliveredSince = new Date(getNow().getTime() - cooldownMs);
    const recentDeliveries = await prisma.opsAlertDelivery.findMany({
      where: {
        opsAlertId: {
          in: input.alertIds
        },
        escalationLevel: input.preview.escalationLevel,
        status: "delivered",
        createdAt: {
          gte: deliveredSince
        }
      }
    });

    if (recentDeliveries.length === 0) {
      return input.preview;
    }

    const throttledRecipientKeys = new Set(
      recentDeliveries.map((delivery) =>
        delivery.recipientUserId ? `user:${delivery.recipientUserId}` : `${delivery.channel}:${delivery.recipientContact}`
      )
    );

    const filteredRecipients = input.preview.recipients.filter((recipient) => {
      const recipientKey = recipient.userId ? `user:${recipient.userId}` : `${recipient.channel}:${recipient.contact}`;
      return !throttledRecipientKeys.has(recipientKey);
    });

    if (filteredRecipients.length === input.preview.recipients.length) {
      return input.preview;
    }

    const blockedCount = input.preview.recipients.length - filteredRecipients.length;
    const cooldownLabel = formatCooldownWindow(cooldownMs);

    if (filteredRecipients.length === 0) {
      return {
        ...input.preview,
        shouldEscalate: false,
        recipients: [],
        reason: `${input.preview.reason} Delivery is currently held by ${cooldownLabel}; ${blockedCount} recipient(s) were contacted recently.`
      };
    }

    return {
      ...input.preview,
      recipients: filteredRecipients,
      reason: `${input.preview.reason} Cooldown held ${blockedCount} recipient(s) for ${cooldownLabel}; remaining recipients can still receive this escalation.`
    };
  }

  async function applyDigestCadencePolicy(preview: OpsAlertEscalationPreview): Promise<OpsAlertEscalationPreview> {
    if (!preview.shouldEscalate || preview.escalationLevel !== "digest" || preview.recipients.length === 0) {
      return preview;
    }

    if (digestCadenceMs <= 0) {
      return preview;
    }

    const deliveredSince = new Date(getNow().getTime() - digestCadenceMs);
    const recentDigestDeliveries = await prisma.opsAlertDelivery.findMany({
      where: {
        escalationLevel: "digest",
        status: "delivered",
        createdAt: {
          gte: deliveredSince
        }
      }
    });

    if (recentDigestDeliveries.length === 0) {
      return preview;
    }

    const throttledRecipientKeys = new Set(
      recentDigestDeliveries.map((delivery) =>
        delivery.recipientUserId ? `user:${delivery.recipientUserId}` : `${delivery.channel}:${delivery.recipientContact}`
      )
    );

    const filteredRecipients = preview.recipients.filter((recipient) => {
      const recipientKey = recipient.userId ? `user:${recipient.userId}` : `${recipient.channel}:${recipient.contact}`;
      return !throttledRecipientKeys.has(recipientKey);
    });

    if (filteredRecipients.length === preview.recipients.length) {
      return preview;
    }

    const blockedCount = preview.recipients.length - filteredRecipients.length;
    const cadenceLabel = formatCooldownWindow(digestCadenceMs);

    if (filteredRecipients.length === 0) {
      return {
        ...preview,
        shouldEscalate: false,
        recipients: [],
        reason: `${preview.reason} Digest cadence is currently holding this batch for ${cadenceLabel}; ${blockedCount} recipient(s) already received a recent watch digest.`
      };
    }

    return {
      ...preview,
      recipients: filteredRecipients,
      reason: `${preview.reason} Digest cadence held ${blockedCount} recipient(s) for ${cadenceLabel}; remaining recipients can still receive this batch.`
    };
  }

  function applyDigestQuietWindowPolicy(preview: OpsAlertEscalationPreview): OpsAlertEscalationPreview {
    if (!preview.shouldEscalate || preview.escalationLevel !== "digest" || preview.recipients.length === 0) {
      return preview;
    }

    const currentHourUtc = getNow().getUTCHours();
    if (isHourInsideWindow(currentHourUtc, digestWindowStartHourUtc, digestWindowEndHourUtc)) {
      return preview;
    }

    const filteredRecipients = preview.recipients.filter((recipient) => recipient.escalationTier === "secondary");
    const blockedCount = preview.recipients.length - filteredRecipients.length;

    if (filteredRecipients.length > 0) {
      return {
        ...preview,
        recipients: filteredRecipients,
        reason:
          `${preview.reason} Quiet window is holding ${blockedCount} primary recipient(s); ` +
          `secondary after-hours fallback remains allowed outside ${formatUtcHour(digestWindowStartHourUtc)}-${formatUtcHour(digestWindowEndHourUtc)}.`
      };
    }

    return {
      ...preview,
      shouldEscalate: false,
      recipients: [],
      reason:
        `${preview.reason} Digest delivery window is currently closed. ` +
        `Watch digests are allowed between ${formatUtcHour(digestWindowStartHourUtc)} and ${formatUtcHour(digestWindowEndHourUtc)}.`
    };
  }

  async function listDeliveriesInternal(alertId: string, limit = 20): Promise<OpsAlertDeliveriesResponse["deliveries"]> {
    const deliveries = await prisma.opsAlertDelivery.findMany({
      where: {
        opsAlertId: alertId
      },
      orderBy: [
        {
          createdAt: "desc"
        }
      ],
      take: Math.min(Math.max(Math.trunc(limit), 1), 100)
    });

    return deliveries.map(mapOpsAlertDelivery);
  }

  return {
    async refreshFromOpsSummary(input?: {
      windowHours?: number;
      recentLimit?: number;
      summaryLimit?: number;
    }) {
      const summary = await deps.getRouteDecisionOpsSummary(input);
      const detectedAlerts = detectOpsAlertsFromSummary(summary);
      const now = new Date();
      const dedupeKeys = new Set(detectedAlerts.map((alert) => alert.id));

      await prisma.$transaction(async (tx) => {
        for (const alert of detectedAlerts) {
          const existing = await tx.opsAlert.findUnique({
            where: {
              dedupeKey: alert.id
            }
          });

          const metadata = {
            source: "route_decision_ops_summary",
            summarySeverity: summary.operationalSummary.overallSeverity,
            generatedAt: summary.generatedAt,
            ...(alert.id === "inventory-failure-domain-risk"
              ? {
                  inventoryRiskLevel: summary.operationalSummary.inventoryHealth.riskLevel,
                  inventoryFailedDimensions: summary.operationalSummary.inventoryHealth.failedDimensions,
                  inventoryPolicyViolationMessage: summary.operationalSummary.inventoryHealth.policyViolationMessage,
                  activeInventoryEndpoints: summary.operationalSummary.inventoryHealth.activeEndpoints,
                  distinctInventoryProviders: summary.operationalSummary.inventoryHealth.distinctProviders,
                  distinctInventoryAsns: summary.operationalSummary.inventoryHealth.distinctAsns,
                  distinctInventoryRegions: summary.operationalSummary.inventoryHealth.distinctRegions,
                  minimumRecommendedFailureDomains: summary.operationalSummary.inventoryHealth.minimumRecommendedFailureDomains
                }
              : {})
          };

          if (!existing) {
            await tx.opsAlert.create({
              data: {
                id: randomUUID(),
                alertType: alert.id,
                severity: alert.severity,
                status: "active",
                dedupeKey: alert.id,
                title: alert.title,
                detail: alert.detail,
                metadata: asJson(metadata),
                startedAt: now,
                lastDetectedAt: now
              }
            });
            continue;
          }

          const nextStatus =
            existing.status === OpsAlertStatus.snoozed && existing.snoozedUntil && existing.snoozedUntil > now
              ? OpsAlertStatus.snoozed
              : existing.status === OpsAlertStatus.acknowledged
                ? OpsAlertStatus.acknowledged
                : OpsAlertStatus.active;

          await tx.opsAlert.update({
            where: {
              id: existing.id
            },
            data: {
              alertType: alert.id,
              severity: alert.severity,
              title: alert.title,
              detail: alert.detail,
              metadata: asJson(metadata),
              lastDetectedAt: now,
              resolvedAt: null,
              status: nextStatus
            }
          });
        }

        const noLongerDetected = await tx.opsAlert.findMany({
          where: {
            dedupeKey: {
              notIn: [...dedupeKeys]
            },
            status: {
              in: ["active", "acknowledged", "snoozed"]
            }
          },
          select: {
            id: true
          }
        });

        if (noLongerDetected.length > 0) {
          await tx.opsAlert.updateMany({
            where: {
              id: {
                in: noLongerDetected.map((alert) => alert.id)
              }
            },
            data: {
              status: "resolved",
              resolvedAt: now,
              snoozedUntil: null
            }
          });
        }
      });
    },

    async list(input?: OpsAlertListOptions) {
      if (input?.refresh !== false) {
        await this.refreshFromOpsSummary({
          windowHours: input?.windowHours,
          recentLimit: input?.recentLimit,
          summaryLimit: input?.summaryLimit
        });
      }

      const alerts = await prisma.opsAlert.findMany({
        where: input?.includeResolved
          ? undefined
          : {
              status: {
                not: "resolved"
              }
            },
        orderBy: [
          {
            lastDetectedAt: "desc"
          },
          {
            updatedAt: "desc"
          }
        ],
        take: input?.limit ?? 50
      });

      return alerts.map(mapOpsAlert);
    },

    async acknowledge(alertId: string) {
      const updated = await prisma.opsAlert.update({
        where: {
          id: alertId
        },
        data: {
          status: "acknowledged",
          acknowledgedAt: new Date(),
          snoozedUntil: null
        }
      });

      return mapOpsAlert(updated);
    },

    async snooze(alertId: string, minutes: number) {
      const safeMinutes = Math.min(Math.max(Math.trunc(minutes), 1), 7 * 24 * 60);
      const snoozedUntil = new Date(Date.now() + safeMinutes * 60 * 1000);
      const updated = await prisma.opsAlert.update({
        where: {
          id: alertId
        },
        data: {
          status: "snoozed",
          snoozedUntil,
          acknowledgedAt: new Date()
        }
      });

      return mapOpsAlert(updated);
    },

    async unacknowledge(alertId: string) {
      const updated = await prisma.opsAlert.update({
        where: {
          id: alertId
        },
        data: {
          status: "active",
          acknowledgedAt: null,
          snoozedUntil: null,
          resolvedAt: null
        }
      });

      return mapOpsAlert(updated);
    },

    async getEscalationPreview(alertId: string) {
      const alert = await loadAlertOrThrow(alertId);
      const recipients = await loadEscalationRecipients();
      const preview = buildOpsAlertEscalationPreview({
        alert: mapOpsAlert(alert),
        recipients
      });
      const cooldownAwarePreview = await applyDeliveryCooldownPolicy({
        alertIds: [alertId],
        preview
      });

      return applyDigestQuietWindowPolicy(cooldownAwarePreview);
    },

    async listDeliveries(alertId: string, limit = 20): Promise<OpsAlertDeliveriesResponse["deliveries"]> {
      await loadAlertOrThrow(alertId);
      return listDeliveriesInternal(alertId, limit);
    },

    async deliver(
      alertId: string,
      actorUserId?: string | null
    ): Promise<DeliverOpsAlertResponse> {
      const alert = await loadAlertOrThrow(alertId);
      const preview = await this.getEscalationPreview(alertId);

      if (!preview.shouldEscalate || preview.recipients.length === 0 || preview.escalationLevel === "none") {
        throw new Error("Ops alert does not currently require escalation delivery");
      }

      if (preview.escalationLevel === "digest") {
        throw new Error("Digest-level ops alerts must be delivered through the digest batch flow");
      }

      const batchId = randomUUID();
      const deliveries = await prisma.$transaction(async (tx) => {
        const created: OpsAlertDelivery[] = [];
        const recipientGroups = groupRecipientsByChainStep(preview.recipients);

        for (const [groupIndex, group] of recipientGroups.entries()) {
          const shouldExecuteGroup = groupIndex === 0 || created.some((entry) => entry.status === "failed");
          if (!shouldExecuteGroup) {
            continue;
          }

          for (const recipient of group) {
            const deliveryResult = await deps.deliveryTransport.deliver({
              alertId: alert.id,
              batchId,
              channel: recipient.channel,
              recipientDisplayName: recipient.displayName,
              recipientContact: recipient.contact,
              subject: preview.recommendedSubject,
              message: preview.recommendedMessage
            });

            created.push(
              await tx.opsAlertDelivery.create({
                data: {
                  id: randomUUID(),
                  opsAlertId: alert.id,
                  batchId,
                  channel: recipient.channel === "telegram" ? ContactType.telegram : ContactType.email,
                  escalationLevel: preview.escalationLevel,
                  status: deliveryResult.status,
                  recipientUserId: recipient.userId,
                  recipientDisplayName: recipient.displayName,
                  recipientContact: recipient.contact,
                  subject: preview.recommendedSubject,
                  message: preview.recommendedMessage,
                  reason: deliveryResult.failureReason ?? recipient.reason,
                  deliveryPath: deliveryResult.deliveryPath,
                  providerMessageId: deliveryResult.providerMessageId,
                  actorUserId: actorUserId ?? null,
                  deliveredAt: deliveryResult.deliveredAt,
                  metadata: asJson({
                    previewGeneratedAt: preview.generatedAt,
                    alertStatus: preview.alertStatus,
                    alertSeverity: preview.alertSeverity,
                    escalationReason: recipient.reason,
                    escalationTier: recipient.escalationTier,
                    chainStep: recipient.chainStep,
                    ...(deliveryResult.failureReason ? { failureReason: deliveryResult.failureReason } : {}),
                    ...(deliveryResult.metadata ? { transport: deliveryResult.metadata } : {})
                  })
                }
              })
            );
          }
        }

        return created;
      });

      return {
        alert: mapOpsAlert(alert),
        preview,
        deliveries: deliveries.map(mapOpsAlertDelivery)
      };
    },

    async deliverDigest(actorUserId?: string | null): Promise<DeliverOpsAlertDigestResponse> {
      const recipients = await loadEscalationRecipients();
      const digestAlerts = await loadDigestEligibleAlerts();

      if (digestAlerts.length === 0) {
        throw new Error("No active watch-level ops alerts currently require digest delivery");
      }

      if (recipients.length === 0) {
        throw new Error("Ops alert digest does not have any active admin recipients");
      }

      const batchId = randomUUID();
      const subject = buildDigestSubject(digestAlerts.length);
      const message = buildDigestMessage(digestAlerts);
      const rootAlertId = digestAlerts[0]?.id ?? "digest";
      const preview = buildOpsAlertEscalationPreview({
        alert: {
          id: rootAlertId,
          status: "active",
          severity: "watch",
          title: subject,
          detail: message,
          lastDetectedAt: digestAlerts[0]?.lastDetectedAt ?? new Date().toISOString(),
          metadata: {}
        },
        recipients
      });
      const cooldownAwarePreview = await applyDeliveryCooldownPolicy({
        alertIds: digestAlerts.map((alert) => alert.id),
        preview
      });
      const quietWindowAwarePreview = applyDigestQuietWindowPolicy(cooldownAwarePreview);
      const cadenceAwarePreview = await applyDigestCadencePolicy(quietWindowAwarePreview);
      const recipientGroups = groupRecipientsByChainStep(cadenceAwarePreview.recipients);

      if (!cadenceAwarePreview.shouldEscalate || cadenceAwarePreview.recipients.length === 0) {
        if (cadenceAwarePreview.reason.includes("Digest delivery window is currently closed")) {
          throw new Error("Ops alert digest delivery is currently held by quiet window policy");
        }

        if (cadenceAwarePreview.reason.includes("Digest cadence")) {
          throw new Error("Ops alert digest delivery is currently held by digest cadence policy");
        }

        throw new Error("Ops alert digest delivery is currently held by cooldown policy");
      }

      const deliveries = await prisma.$transaction(async (tx) => {
        const created: OpsAlertDelivery[] = [];

        for (const [groupIndex, group] of recipientGroups.entries()) {
          const shouldExecuteGroup = groupIndex === 0 || created.length === 0 || created.some((entry) => entry.status === "failed");
          if (!shouldExecuteGroup) {
            continue;
          }

          for (const recipient of group) {
            const deliveryResult = await deps.deliveryTransport.deliver({
              alertId: rootAlertId,
              batchId,
              channel: recipient.channel,
              recipientDisplayName: recipient.displayName,
              recipientContact: recipient.contact,
              subject,
              message
            });

            for (const [index, alert] of digestAlerts.entries()) {
              created.push(
                await tx.opsAlertDelivery.create({
                  data: {
                    id: randomUUID(),
                    opsAlertId: alert.id,
                    batchId,
                    channel: recipient.channel === "telegram" ? ContactType.telegram : ContactType.email,
                    escalationLevel: "digest",
                    status: deliveryResult.status,
                    recipientUserId: recipient.userId,
                    recipientDisplayName: recipient.displayName,
                    recipientContact: recipient.contact,
                    subject,
                    message,
              reason: deliveryResult.failureReason ?? recipient.reason,
                    deliveryPath: deliveryResult.deliveryPath,
                    providerMessageId: deliveryResult.providerMessageId,
                    actorUserId: actorUserId ?? null,
                    deliveredAt: deliveryResult.deliveredAt,
                    metadata: asJson({
                      alertStatus: alert.status,
                      alertSeverity: alert.severity,
                      digestAlertIds: digestAlerts.map((entry) => entry.id),
                      digestAlertCount: digestAlerts.length,
                      digestRootAlertId: rootAlertId,
                      digestPosition: index + 1,
                      escalationTier: recipient.escalationTier,
                      chainStep: recipient.chainStep,
                      ...(deliveryResult.failureReason ? { failureReason: deliveryResult.failureReason } : {}),
                      ...(deliveryResult.metadata ? { transport: deliveryResult.metadata } : {})
                    })
                  }
                })
              );
            }
          }
        }

        return created;
      });

      return {
        alerts: digestAlerts,
        deliveries: deliveries.map(mapOpsAlertDelivery),
        batchId,
        subject
      };
    },

    async retryDelivery(
      alertId: string,
      deliveryId: string,
      actorUserId?: string | null
    ): Promise<OpsAlertDeliveriesResponse["deliveries"]> {
      return replayDelivery(alertId, deliveryId, actorUserId, "retry");
    },

    async resendDelivery(
      alertId: string,
      deliveryId: string,
      actorUserId?: string | null
    ): Promise<OpsAlertDeliveriesResponse["deliveries"]> {
      return replayDelivery(alertId, deliveryId, actorUserId, "resend");
    }
  };
}
