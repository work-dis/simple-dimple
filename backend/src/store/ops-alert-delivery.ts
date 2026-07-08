import { createMessageTransport, type MessageTransportEnv } from "../transport/message-transport.js";

export type OpsAlertDeliveryTransportChannel = "telegram" | "email";

export type OpsAlertDeliveryTransportInput = {
  alertId: string;
  batchId: string;
  channel: OpsAlertDeliveryTransportChannel;
  recipientDisplayName: string;
  recipientContact: string;
  subject: string;
  message: string;
};

export type OpsAlertDeliveryTransportResult = {
  status: "delivered" | "failed";
  deliveryPath: string;
  providerMessageId: string | null;
  deliveredAt: Date | null;
  failureReason?: string;
  metadata?: Record<string, unknown>;
};

export type OpsAlertDeliveryTransport = {
  deliver(input: OpsAlertDeliveryTransportInput): Promise<OpsAlertDeliveryTransportResult>;
};

export function createOpsAlertDeliveryTransport(env: MessageTransportEnv = process.env): OpsAlertDeliveryTransport {
  const transport = createMessageTransport(env);

  return {
    deliver(input) {
      return transport.deliver({
        channel: input.channel,
        recipientContact: input.recipientContact,
        subject: input.subject,
        message: input.message,
        idempotencyKey: `${input.batchId}:${input.alertId}:${input.recipientContact}`
      });
    }
  };
}
