export type ScreenshotArtifact = {
  id: string;
  png: Buffer;
  createdAt: number;
  sessionKey: string;
  contentType: "image/png";
};

const store = new Map<string, ScreenshotArtifact>();
const TTL_MS = 30 * 60 * 1000;
const MAX_ITEMS = 40;

function prune() {
  const now = Date.now();
  for (const [id, item] of store) {
    if (now - item.createdAt > TTL_MS) store.delete(id);
  }
  while (store.size > MAX_ITEMS) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
    else break;
  }
}

export function putScreenshot(sessionKey: string, png: Buffer): ScreenshotArtifact {
  prune();
  const id = `cu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const artifact: ScreenshotArtifact = {
    id,
    png,
    createdAt: Date.now(),
    sessionKey,
    contentType: "image/png",
  };
  store.set(id, artifact);
  return artifact;
}

export function getScreenshot(id: string): ScreenshotArtifact | undefined {
  prune();
  const item = store.get(id);
  if (!item) return undefined;
  if (Date.now() - item.createdAt > TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return item;
}

export function screenshotPublicUrl(id: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  if (!base) return `/api/computer-use/screenshots/${id}`;
  return `${base}/api/computer-use/screenshots/${id}`;
}
