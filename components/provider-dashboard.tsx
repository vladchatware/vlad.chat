"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PROVIDER_MODELS, TOP_UP_PRICE_USD, TOP_UP_TOKENS } from "@/lib/provider";

const OPENCODE_CONFIG = JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  provider: {
    vlad: {
      npm: "@ai-sdk/openai-compatible",
      name: "vlad.chat",
      options: {
        baseURL: "https://vlad.chat/v1",
        apiKey: "{env:VLAD_API_KEY}",
      },
      models: Object.fromEntries(
        PROVIDER_MODELS.map((model) => [model.id, { name: model.name }]),
      ),
    },
  },
}, null, 2);

const DEEPSEEK_CONFIG = `llm-pi-ai:
  providers:
    vlad:
      apiKeyEnv: VLAD_API_KEY
      api: openai-completions
      baseURL: https://vlad.chat/v1
      models:
${PROVIDER_MODELS.map((model) => `        - id: ${model.id}`).join("\n")}`;

const tokenFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function ProviderDashboard() {
  const user = useQuery(api.users.viewer);
  const { signIn } = useAuthActions();

  if (user === undefined) {
    return <PageShell><p className="text-sm text-muted-foreground">Loading provider account…</p></PageShell>;
  }

  if (!user || user.isAnonymous) {
    return <SignedOutProvider onSignIn={() => signIn("google")} />;
  }

  return <ProviderAccount />;
}

function SignedOutProvider({ onSignIn }: { onSignIn: () => void }) {
  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to use provider API</CardTitle>
          <CardDescription>
            API keys use your existing vlad.chat trial credits and paid balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onSignIn}>Sign in with Google</Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function ProviderAccount() {
  return (
    <PageShell>
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">vlad.chat provider</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          OpenAI-compatible chat completions for OpenCode, DeepSeek Harness, and other clients.
        </p>
      </section>
      <CreditBalance />
      <ApiKeyManager />
      <ConfigCard title="OpenCode" filename="opencode.json" value={OPENCODE_CONFIG} />
      <ConfigCard title="DeepSeek Harness" filename="$DSH_HOME/settings.yaml" value={DEEPSEEK_CONFIG} />
    </PageShell>
  );
}

function CreditBalance() {
  const balance = useQuery(api.users.creditBalance);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function topUp() {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout_session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/provider" }),
      });
      const session: { url?: string; error?: string } = await response.json();
      if (!response.ok || !session.url) throw new Error(session.error ?? "Could not start checkout.");
      window.location.assign(session.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout.");
      setWorking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shared credits</CardTitle>
        <CardDescription>Browser chat and API calls draw from same balance.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-3xl font-semibold tabular-nums">
            {formatTokens(balance?.totalTokens ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTokens(balance?.trialTokens ?? 0)} trial · {formatTokens(balance?.paidTokens ?? 0)} paid
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            ${TOP_UP_PRICE_USD} adds {formatTokens(TOP_UP_TOKENS)} paid tokens.
          </p>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
        <Button onClick={topUp} disabled={working}>Top up ${TOP_UP_PRICE_USD}</Button>
      </CardContent>
    </Card>
  );
}

function ApiKeyManager() {
  const keys = useQuery(api.users.listApiKeys);
  const revokeApiKey = useMutation(api.users.revokeApiKey);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || working) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body: { apiKey?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create API key.");
      if (!body.apiKey) throw new Error("Provider did not return an API key.");
      setNewKey(body.apiKey);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create API key.");
    } finally {
      setWorking(false);
    }
  }

  async function revoke(keyId: Id<"apiKeys">) {
    setError(null);
    try {
      await revokeApiKey({ apiKeyId: keyId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke API key.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>Secret appears once. Store it in your client credential manager.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <form onSubmit={createKey} className="flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="OpenCode laptop"
              maxLength={80}
              aria-label="API key name"
            />
            <Button type="submit" disabled={!name.trim() || working}>
              <PlusIcon /> Create
            </Button>
          </form>

          {newKey && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium">Copy this key now. It will not be shown again.</p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background/70 px-3 py-2 text-xs">
                  {newKey}
                </code>
                <CopyButton value={newKey} />
              </div>
            </div>
          )}

          <div className="divide-y rounded-lg border">
            {(keys ?? []).map((key) => (
              <div key={key._id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <KeyRoundIcon className="size-4 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{key.name}</span>
                    {key.revokedAt && <span className="text-xs text-destructive">Revoked</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {key.prefix}•••• · Created {formatDate(key.createdAt)}
                    {key.lastUsedAt ? ` · Last used ${formatDate(key.lastUsedAt)}` : " · Never used"}
                  </p>
                </div>
                {!key.revokedAt && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => revoke(key._id)}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            ))}
            {keys?.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No API keys yet.</p>
            )}
          </div>
      </CardContent>
    </Card>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Button asChild variant="outline" className="w-fit rounded-full">
          <Link href="/"><ArrowLeftIcon /> Back to chat</Link>
        </Button>
        {children}
      </div>
    </main>
  );
}

function ConfigCard({ title, filename, value }: { title: string; filename: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Set VLAD_API_KEY, then add this to {filename}.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 pr-14 text-xs leading-relaxed">
            {value}
          </pre>
          <CopyButton value={value} className="absolute right-2 top-2" />
        </div>
      </CardContent>
    </Card>
  );
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className}
      aria-label="Copy to clipboard"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function formatTokens(value: number) {
  return tokenFormatter.format(value);
}

function formatDate(value: number) {
  return dateFormatter.format(value);
}
