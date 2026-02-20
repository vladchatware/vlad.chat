import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

type ResendReceivedPayload = {
  type: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string | null;
    message_id?: string;
    text?: string | null;
    html?: string | null;
  };
};

function escapeTelegramMarkdown(value: string): string {
  return value.replace(/([_*`\[])/g, '\\$1');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

function getWebhookHeader(headers: Headers, key: string): string | null {
  return headers.get(`svix-${key}`) ?? headers.get(`webhook-${key}`);
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function verifyResendWebhookSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = getWebhookHeader(headers, 'id');
  const timestamp = getWebhookHeader(headers, 'timestamp');
  const signatureHeader = getWebhookHeader(headers, 'signature');

  if (!id || !timestamp || !signatureHeader) {
    console.error('Webhook signature verification failed: missing svix headers');
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    console.error('Webhook signature verification failed: invalid timestamp');
    return false;
  }

  // Match Svix default replay protection window.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5) {
    console.error('Webhook signature verification failed: timestamp outside 5 minute window');
    return false;
  }

  const signingSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const secretBytes = Buffer.from(signingSecret, 'base64');
  if (!secretBytes.length) {
    console.error('Webhook signature verification failed: invalid webhook secret');
    return false;
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expectedSignature = createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  // Header can contain one or multiple entries like: "v1,abc v1,def" (or comma-joined variants)
  const signatures = Array.from(signatureHeader.matchAll(/v1,([A-Za-z0-9+/=]+)/g)).map((m) => m[1]);
  if (!signatures.length) {
    console.error('Webhook signature verification failed: no v1 signature in header');
    return false;
  }

  return signatures.some((signature) => safeEqual(signature, expectedSignature));
}

export async function POST(req: Request) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!telegramBotToken || !telegramChatId || !resendWebhookSecret) {
    console.error('Missing TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, or RESEND_WEBHOOK_SECRET');
    return NextResponse.json(
      { ok: false, error: 'missing webhook configuration' },
      { status: 500 }
    );
  }

  const rawBody = await req.text();

  if (!verifyResendWebhookSignature(rawBody, req.headers, resendWebhookSecret)) {
    return NextResponse.json({ ok: false, error: 'invalid webhook signature' }, { status: 400 });
  }

  let payload: ResendReceivedPayload;
  try {
    payload = JSON.parse(rawBody) as ResendReceivedPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json payload' }, { status: 400 });
  }

  if (payload.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const emailId = payload.data?.email_id;
  const from = payload.data?.from;
  const toRaw = payload.data?.to;
  const subject = payload.data?.subject ?? '(no subject)';
  const textBody = payload.data?.text?.trim() || '';
  const htmlBody = payload.data?.html?.trim() || '';

  const to = Array.isArray(toRaw) ? toRaw.join(', ') : toRaw ?? '';

  if (!emailId || !from || !to) {
    return NextResponse.json(
      { ok: false, error: 'missing required fields: email_id, from, to' },
      { status: 400 }
    );
  }

  const textSection = textBody
    ? `\n\n*Text:*\n\`\`\`\n${escapeTelegramMarkdown(truncate(textBody, 1400))}\n\`\`\``
    : '';
  const htmlSection = htmlBody
    ? `\n\n*HTML:*\n\`\`\`\n${escapeTelegramMarkdown(truncate(htmlBody, 1400))}\n\`\`\``
    : '';

  const message =
    '*Incoming email*' +
    `\n*From:* \`${escapeTelegramMarkdown(from)}\`` +
    `\n*To:* \`${escapeTelegramMarkdown(to)}\`` +
    `\n*Subject:* \`${escapeTelegramMarkdown(subject)}\`` +
    `\n*Email ID:* \`${escapeTelegramMarkdown(emailId)}\`` +
    textSection +
    htmlSection;

  const text = truncate(message, 3900);

  const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!telegramResponse.ok) {
    const errorBody = await telegramResponse.text();
    console.error('Telegram sendMessage failed', telegramResponse.status, errorBody);
    return NextResponse.json(
      { ok: false, error: 'failed to forward to telegram' },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
