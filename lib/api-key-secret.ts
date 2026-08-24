import { createHash, randomBytes } from "node:crypto";

export function generateApiKey() {
  const secret = `vlad_${randomBytes(32).toString("base64url")}`;
  return {
    secret,
    prefix: secret.slice(0, 13),
    digest: digestApiKey(secret),
  };
}

export function digestApiKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
