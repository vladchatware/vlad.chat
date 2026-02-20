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
  };
};

function escapeTelegramMarkdown(value: string): string {
  return value.replace(/([_*`\[])/g, '\\$1');
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

  if (!id || !timestamp || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  // Match Svix default replay protection window.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5) return false;

  const signingSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expectedSignature = createHmac('sha256', signingSecret).update(signedContent).digest('base64');

  const signatures = signatureHeader
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [version, signature] = entry.split(',');
      return { version, signature };
    });

  return signatures.some(({ version, signature }) => version === 'v1' && !!signature && safeEqual(signature, expectedSignature));
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

  const to = Array.isArray(toRaw) ? toRaw.join(', ') : toRaw ?? '';

  if (!emailId || !from || !to) {
    return NextResponse.json(
      { ok: false, error: 'missing required fields: email_id, from, to' },
      { status: 400 }
    );
  }

  const text =
    '*Incoming email*' +
    `\n*From:* \`${escapeTelegramMarkdown(from)}\`` +
    `\n*To:* \`${escapeTelegramMarkdown(to)}\`` +
    `\n*Subject:* \`${escapeTelegramMarkdown(subject)}\`` +
    `\n*Email ID:* \`${escapeTelegramMarkdown(emailId)}\``;

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
