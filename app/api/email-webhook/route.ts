import { NextResponse } from 'next/server';

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

export async function POST(req: Request) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken || !telegramChatId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return NextResponse.json(
      { ok: false, error: 'missing telegram configuration' },
      { status: 500 }
    );
  }

  let payload: ResendReceivedPayload;
  try {
    payload = (await req.json()) as ResendReceivedPayload;
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
