export type SandboxCredentials =
  | { mode: "oidc" }
  | { mode: "token"; token: string; teamId: string; projectId: string }
  | { mode: "none" };

export function resolveSandboxCredentials(): SandboxCredentials {
  const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || "";
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN || "";
  if (token && teamId && projectId) {
    return { mode: "token", token, teamId, projectId };
  }
  if (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL) {
    return { mode: "oidc" };
  }
  return { mode: "none" };
}

export function sandboxCredentialParams(credentials: SandboxCredentials) {
  if (credentials.mode === "token") {
    return {
      token: credentials.token,
      teamId: credentials.teamId,
      projectId: credentials.projectId,
    };
  }
  return {};
}
