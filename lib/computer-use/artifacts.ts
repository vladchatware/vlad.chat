import type { ComputerSession } from "./types";
import { COMPUTER_USE_MAX_TTL_MS } from "./limits";

export type ScreenshotArtifact = {
  id: string;
  png: Buffer;
  createdAt: number;
  sessionKey: string;
  contentType: "image/png" | "image/jpeg";
};

type StoredScreenshot = ScreenshotArtifact & { expiresAt: number };

const developmentStore = new Map<string, StoredScreenshot>();
const TTL_MS = 30 * 60 * 1000;
const MAX_ITEMS = 40;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

function sniffImageContentType(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

function createArtifactId(): string {
  return `cu_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function pruneDevelopmentStore() {
  const now = Date.now();
  for (const [id, item] of developmentStore) {
    if (now >= item.expiresAt) developmentStore.delete(id);
  }
  while (developmentStore.size > MAX_ITEMS) {
    const oldest = developmentStore.keys().next().value;
    if (!oldest) break;
    developmentStore.delete(oldest);
  }
}

function screenshotStorageConfig(): { siteUrl: string; secret: string } | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.COMPUTER_USE_STORAGE_SECRET;
  if (!convexUrl || !secret) {
    if (process.env.NODE_ENV !== "production") return null;
    throw new Error(
      "Persistent computer-use screenshots require NEXT_PUBLIC_CONVEX_URL and COMPUTER_USE_STORAGE_SECRET.",
    );
  }

  const url = new URL(convexUrl);
  if (url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  } else if (!url.hostname.endsWith(".convex.site")) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL must use a Convex deployment hostname.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return { siteUrl: url.toString().replace(/\/$/, ""), secret };
}

function localArtifact(id: string): StoredScreenshot | undefined {
  pruneDevelopmentStore();
  const item = developmentStore.get(id);
  if (!item || Date.now() >= item.expiresAt) {
    developmentStore.delete(id);
    return undefined;
  }
  return item;
}

export async function putScreenshot(
  sessionKey: string,
  png: Buffer,
): Promise<ScreenshotArtifact> {
  if (png.length === 0 || png.length > MAX_SCREENSHOT_BYTES) {
    throw new Error("Screenshot is empty or exceeds the 1 MB storage limit.");
  }
  const contentType = sniffImageContentType(png);
  if (!contentType) throw new Error("Screenshot must be a valid PNG or JPEG image.");

  const id = createArtifactId();
  const createdAt = Date.now();
  const artifact: ScreenshotArtifact = {
    id,
    png,
    createdAt,
    sessionKey,
    contentType,
  };
  const config = screenshotStorageConfig();

  if (!config) {
    developmentStore.set(id, { ...artifact, expiresAt: createdAt + TTL_MS });
    pruneDevelopmentStore();
    return artifact;
  }

  const response = await fetch(`${config.siteUrl}/computer-use/screenshots`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secret}`,
      "Content-Type": artifact.contentType,
      "X-Computer-Use-Artifact": id,
      "X-Computer-Use-Session": sessionKey,
    },
    body: new Uint8Array(png),
    cache: "no-store",
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Convex screenshot upload failed (${response.status})${details ? `: ${details}` : ""}`,
    );
  }

  return artifact;
}

export async function publishLiveComputerSession(
  sessionKey: string,
  sessionId: string,
  session: Partial<ComputerSession> | null,
  status = session ? "active" : "ended",
): Promise<void> {
  const config = screenshotStorageConfig();
  if (!config) {
    throw new Error("Persistent computer-use sessions require NEXT_PUBLIC_CONVEX_URL and COMPUTER_USE_STORAGE_SECRET.");
  }

  const response = await fetch(`${config.siteUrl}/computer-use/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(session ? session : {}),
      sessionKey,
      sessionId,
      status,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Convex live-session publish failed (${response.status})${details ? `: ${details}` : ""}`,
    );
  }
}

export type StoredComputerSession = Pick<ComputerSession, "sessionKey" | "sessionId"> &
  Partial<Omit<ComputerSession, "sessionKey" | "sessionId">> & {
  updatedAt: number;
  expiresAt: number;
};

async function requestSessionStore(path: string, init: RequestInit): Promise<Response> {
  const config = screenshotStorageConfig();
  if (!config) {
    throw new Error("Persistent computer-use sessions require Convex URL and storage secret.");
  }
  return fetch(`${config.siteUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.secret}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

export async function getStoredComputerSession(
  sessionKey: string,
): Promise<StoredComputerSession | null> {
  const response = await requestSessionStore(
    `/computer-use/sessions?sessionKey=${encodeURIComponent(sessionKey)}`,
    { method: "GET" },
  );
  if (!response.ok) {
    throw new Error(`Convex live-session lookup failed (${response.status}).`);
  }
  const body = (await response.json()) as { session: StoredComputerSession | null };
  return body.session;
}

export async function recordComputerSessionActivity(
  session: Pick<ComputerSession, "sessionKey" | "sessionId" | "createdAt">,
): Promise<{ stepCount: number; lastUsedAt: number }> {
  const response = await requestSessionStore("/computer-use/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: session.sessionKey,
      sessionId: session.sessionId,
      status: "active",
      event: "activity",
      expiresAt: session.createdAt + COMPUTER_USE_MAX_TTL_MS,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Convex session activity failed (${response.status}).`);
  }
  return (await response.json()) as { stepCount: number; lastUsedAt: number };
}

export async function listStoredComputerSessionsForCleanup(): Promise<StoredComputerSession[]> {
  const response = await requestSessionStore("/computer-use/sessions?cleanup=1", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Convex session cleanup lookup failed (${response.status}).`);
  }
  const body = (await response.json()) as { sessions: StoredComputerSession[] };
  return body.sessions;
}


export async function getScreenshot(
  id: string,
): Promise<ScreenshotArtifact | undefined> {
  const config = screenshotStorageConfig();
  if (!config) return localArtifact(id);

  const response = await fetch(
    `${config.siteUrl}/computer-use/screenshots/${encodeURIComponent(id)}`,
    {
      headers: { Authorization: `Bearer ${config.secret}` },
      cache: "no-store",
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Convex screenshot download failed (${response.status}).`);
  }

  const contentType = response.headers.get("content-type");
  const sessionKey = response.headers.get("x-computer-use-session");
  const createdAt = Number(response.headers.get("x-computer-use-created-at"));
  if (
    (contentType !== "image/jpeg" && contentType !== "image/png") ||
    !sessionKey ||
    !Number.isFinite(createdAt)
  ) {
    throw new Error("Convex returned invalid screenshot metadata.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length === 0 ||
    bytes.length > MAX_SCREENSHOT_BYTES ||
    sniffImageContentType(bytes) !== contentType
  ) {
    throw new Error("Convex returned invalid screenshot bytes.");
  }
  return {
    id,
    png: bytes,
    createdAt,
    sessionKey,
    contentType,
  };
}

/**
 * Prefer the deployment that actually serves this screenshot route.
 * Preview builds often keep NEXT_PUBLIC_SITE_URL=https://vlad.chat, which 404s.
 */
export function screenshotPublicUrl(id: string): string {
  const path = `/api/computer-use/screenshots/${id}`;
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const vercel =
    process.env.VERCEL_URL && !process.env.VERCEL_URL.startsWith("http")
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.VERCEL_URL || "").replace(/\/$/, "");
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV;
  // On Preview / non-production Vercel deploys, always use this deployment's host.
  if (env === "preview" || (vercel && env !== "production")) {
    return `${vercel}${path}`;
  }
  const base = site || vercel;
  if (!base) return path;
  return `${base}${path}`;
}
