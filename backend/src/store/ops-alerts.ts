import { randomUUID } from "node:crypto";

import type { PrismaClient, OpsAlertDelivery } from "../generated/prisma/client.js";
import { ContactType, OpsAlertStatus, UserStatus } from "../generated/prisma/client.js";
import type {
  DeliverOpsAlertDigestResponse,
  DeliverOpsAlertResponse,
  OpsAlertDeliveriesResponse,
  OpsAlertEscalationPreview,
  OpsAlertListOptions,
  RouteDecisionOpsSummary,
} from "../types.js";
import { detectOpsAlertsFromSummary } from "./ops-alert-detector.js";
import type { OpsAlertDeliveryTransport } from "./ops-alert-delivery.js";
import { asJson, mapDeliveryChannel, mapOpsAlert, mapOpsAlertDelivery, toReplayMetadata } from "./ops-alert-mappers.js";
import { buildDigestMessage, buildDigestSubject } from "./ops-alert-messages.js";
import { buildOpsAlertEscalationPreview } from "./ops-alert-escalation.js";
import { formatCooldownWindow, formatUtcHour, isHourInsideWindow, parseUtcHour } from "./ops-alert-time-window.js";

export { buildOpsAlertEscalationPreview } from "./ops-alert-escalation.js";

type RouteDecisionOpsSummaryLoader = (input?: {
  windowHours?: number;
  recentLimit?: number;
  summaryLimit?: number;
}) => Promise<RouteDecisionOpsSummary>;

type CooldownPolicyInput = {
  alertIds: string[];
  preview: OpsAlertEscalationPreview;
};

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

  function groupRecipientsByChainStep(recipients: OpsAlertEscalationPreview["recipients"]) {
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

  // "const store" + явный "return store" вместо "return { ... }" — некоторые
  // методы (list, resendDelivery) вызывают другие методы через this;
  // state-store.ts (Decision 017) торвёт методы с объекта поодиночке
  // (`listOpsAlerts: opsAlerts.list`), из-за чего при вызове this внутри
  // становится ссылкой на state-store, а не на этот объект. Именованная
  // self-ссылка это чинит без .bind() на каждый метод в state-store.ts.
  const store = {
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
        await store.refreshFromOpsSummary({
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
      const preview = await store.getEscalationPreview(alertId);

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

  return store;
}
