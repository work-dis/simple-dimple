export type MessageTransportChannel = "telegram" | "email";

export type MessageTransportInput = {
  channel: MessageTransportChannel;
  recipientContact: string;
  subject: string;
  message: string;
  idempotencyKey: string;
};

export type MessageTransportResult = {
  status: "delivered" | "failed";
  deliveryPath: string;
  providerMessageId: string | null;
  deliveredAt: Date | null;
  failureReason?: string;
  metadata?: Record<string, unknown>;
};

export type MessageTransport = {
  deliver(input: MessageTransportInput): Promise<MessageTransportResult>;
};

export type MessageTransportEnv = {
  OPS_ALERT_EMAIL_TRANSPORT?: string;
  OPS_ALERT_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  OPS_ALERT_TELEGRAM_TRANSPORT?: string;
  OPS_ALERT_TELEGRAM_BOT_TOKEN?: string;
  OPS_ALERT_TELEGRAM_API_BASE_URL?: string;
};

function trimEnv(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toFailureResult(
  deliveryPath: string,
  failureReason: string,
  metadata?: Record<string, unknown>
): MessageTransportResult {
  return {
    status: "failed",
    deliveryPath,
    providerMessageId: null,
    deliveredAt: null,
    failureReason,
    metadata
  };
}

function parseTelegramChatId(contact: string) {
  const trimmed = contact.trim();

  if (/^-?\d+$/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("chat:")) {
    const chatId = trimmed.slice("chat:".length).trim();
    return /^-?\d+$/.test(chatId) ? chatId : null;
  }

  if (trimmed.startsWith("tg-chat:")) {
    const chatId = trimmed.slice("tg-chat:".length).trim();
    return /^-?\d+$/.test(chatId) ? chatId : null;
  }

  return null;
}

async function deliverViaResend(
  input: MessageTransportInput,
  env: MessageTransportEnv
): Promise<MessageTransportResult> {
  const apiKey = trimEnv(env.RESEND_API_KEY);
  const from = trimEnv(env.OPS_ALERT_EMAIL_FROM);

  if (!isValidEmail(input.recipientContact)) {
    return toFailureResult("resend_api", "Recipient contact is not a valid email address.");
  }

  if (!apiKey || !from) {
    return toFailureResult(
      "resend_api",
      "Resend transport is configured incompletely. Set RESEND_API_KEY and OPS_ALERT_EMAIL_FROM."
    );
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({
        from,
        to: [input.recipientContact],
        subject: input.subject,
        text: input.message
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; error?: string; name?: string }
      | null;

    if (!response.ok || !payload?.id) {
      return toFailureResult(
        "resend_api",
        payload?.message ?? payload?.error ?? `Resend request failed with status ${response.status}.`,
        {
          httpStatus: response.status
        }
      );
    }

    return {
      status: "delivered",
      deliveryPath: "resend_api",
      providerMessageId: payload.id,
      deliveredAt: new Date(),
      metadata: {
        provider: "resend"
      }
    };
  } catch (error) {
    return toFailureResult(
      "resend_api",
      error instanceof Error ? error.message : "Unknown Resend transport error."
    );
  }
}

async function deliverViaTelegramBot(
  input: MessageTransportInput,
  env: MessageTransportEnv
): Promise<MessageTransportResult> {
  const token = trimEnv(env.OPS_ALERT_TELEGRAM_BOT_TOKEN);
  const apiBaseUrl = trimEnv(env.OPS_ALERT_TELEGRAM_API_BASE_URL) || "https://api.telegram.org";
  const chatId = parseTelegramChatId(input.recipientContact);

  if (!chatId) {
    return toFailureResult(
      "telegram_bot_api",
      "Telegram contact must be a numeric chat id or chat:<id> for Bot API delivery."
    );
  }

  if (!token) {
    return toFailureResult(
      "telegram_bot_api",
      "Telegram transport is configured incompletely. Set OPS_ALERT_TELEGRAM_BOT_TOKEN."
    );
  }

  try {
    const response = await fetch(`${apiBaseUrl}/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: input.message
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          description?: string;
          error_code?: number;
          result?: { message_id?: number };
        }
      | null;

    if (!response.ok || !payload?.ok) {
      return toFailureResult(
        "telegram_bot_api",
        payload?.description ?? `Telegram Bot API request failed with status ${response.status}.`,
        {
          httpStatus: response.status,
          errorCode: payload?.error_code ?? null
        }
      );
    }

    return {
      status: "delivered",
      deliveryPath: "telegram_bot_api",
      providerMessageId:
        typeof payload.result?.message_id === "number" ? String(payload.result.message_id) : null,
      deliveredAt: new Date(),
      metadata: {
        provider: "telegram_bot_api",
        chatId
      }
    };
  } catch (error) {
    return toFailureResult(
      "telegram_bot_api",
      error instanceof Error ? error.message : "Unknown Telegram transport error."
    );
  }
}

export function createMessageTransport(env: MessageTransportEnv = process.env): MessageTransport {
  const emailTransport = trimEnv(env.OPS_ALERT_EMAIL_TRANSPORT).toLowerCase();
  const telegramTransport = trimEnv(env.OPS_ALERT_TELEGRAM_TRANSPORT).toLowerCase();

  return {
    async deliver(input) {
      if (input.channel === "email" && emailTransport === "resend") {
        return deliverViaResend(input, env);
      }

      if (input.channel === "telegram" && telegramTransport === "bot_api") {
        return deliverViaTelegramBot(input, env);
      }

      return {
        status: "delivered",
        deliveryPath: "local_dev_outbox",
        providerMessageId: `local-dev:${input.idempotencyKey}:${input.channel}`,
        deliveredAt: new Date(),
        metadata: {
          provider: "local_dev_outbox"
        }
      };
    }
  };
}
