import type { Prisma, OpsAlert, OpsAlertDelivery, ContactType } from "../generated/prisma/client.js";
import { ContactType as ContactTypeEnum } from "../generated/prisma/client.js";
import type { OpsAlertDeliverySummary, OpsAlertSummary } from "../types.js";

// --------------------------------------------------------------------------
// Mapping and serialization helpers shared by the ops-alert store
// --------------------------------------------------------------------------

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapOpsAlert(alert: OpsAlert): OpsAlertSummary {
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

export function mapOpsAlertDelivery(delivery: OpsAlertDelivery): OpsAlertDeliverySummary {
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

export function mapDeliveryChannel(channel: ContactType): "telegram" | "email" {
  return channel === ContactTypeEnum.telegram ? "telegram" : "email";
}

export function toReplayMetadata(
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
