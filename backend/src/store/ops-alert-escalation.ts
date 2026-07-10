import type { OpsAlertEscalationPreview, OpsAlertEscalationRecipient, OpsAlertSummary } from "../types.js";
import { buildAlertMessageBody } from "./ops-alert-messages.js";

// --------------------------------------------------------------------------
// Escalation preview builder — who should be notified about an alert, at
// what level, and why. Cooldown/cadence/quiet-window throttling is applied
// on top of this by the store (those policies need prisma + wall-clock time).
// --------------------------------------------------------------------------

export type EscalationAdminRecipientSource = {
  id: string;
  displayName: string;
  contact: string;
  contactType: "telegram" | "email";
  opsAlertImmediateEnabled: boolean;
  opsAlertDigestEnabled: boolean;
  opsAlertEscalationTier: "primary" | "secondary";
};

export type EscalationPreviewInput = {
  alert: Pick<OpsAlertSummary, "id" | "status" | "severity" | "title" | "detail" | "lastDetectedAt" | "metadata">;
  recipients: EscalationAdminRecipientSource[];
  now?: Date;
};

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
