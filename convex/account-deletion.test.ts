import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = {
  './account.ts': () => import('./account'),
  './_generated/server.ts': () => import('./_generated/server'),
};

async function seededAccount() {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx =>
    ctx.db.insert('users', {
      email: 'agent@vlad.chat',
      trialTokens: 16_000_000,
      tokens: 4_000_000,
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_test_123',
      stripeId: 'cus_test_123',
    }),
  );
  const otherUserId = await t.run(ctx =>
    ctx.db.insert('users', { email: 'other@example.com', trialTokens: 16_000_000 }),
  );
  return { t, userId, otherUserId };
}

describe('account deletion — auth contract', () => {
  it('rejects an unauthenticated caller before touching any data', async () => {
    const { t } = await seededAccount();
    await expect(
      t.action(api.account.deleteAccount, { confirm: 'DELETE' }),
    ).rejects.toThrow(/sign in/i);
  });

  it('requires the literal DELETE confirmation argument', async () => {
    const { t, userId } = await seededAccount();
    const auth = t.withIdentity({ subject: `${userId}|session` });
    // Schema validation rejects anything other than the literal before the handler runs.
    await expect(
      // Wrong case must fail schema validation before the handler runs.
      auth.action(api.account.deleteAccount, { confirm: 'delete' as 'DELETE' }),
    ).rejects.toThrow();
  });
});

describe('account deletion — data cascade', () => {
  it('removes every user-scoped row and the auth records, leaving others intact', async () => {
    const { t, userId, otherUserId } = await seededAccount();

    const { runId, accountId, sessionId } = await t.run(async ctx => {
      await ctx.db.insert('apiKeys', {
        userId,
        name: 'prod',
        prefix: 'vk_',
        digest: 'digest-1',
        createdAt: 1,
      });
      await ctx.db.insert('apiKeys', {
        userId: otherUserId,
        name: 'keep',
        prefix: 'vk_',
        digest: 'digest-other',
        createdAt: 1,
      });
      await ctx.db.insert('notionConnections', {
        userId,
        accessToken: 'secret',
        refreshToken: 'secret',
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        clientId: 'client',
        workspaceId: 'ws',
        botId: 'bot',
      });
      await ctx.db.insert('usage', {
        userId: `${userId}`,
        model: 'zai/glm-5.3-flash',
        provider: 'test',
        usage: { totalTokens: 1234 },
      });
      await ctx.db.insert('meterOverage', {
        userId,
        stripeId: 'cus_test_123',
        credits: 500,
        status: 'pending',
      });
      await ctx.db.insert('storeTransactions', {
        transactionId: 'tx-1',
        originalTransactionId: 'otx-1',
        userId,
        productId: 'chat.vlad.tokens.5',
        tokens: 16_666_666,
        purchasedAt: 1,
        environment: 'Sandbox',
      });
      await ctx.db.insert('computerUseSessions', {
        sessionKey: `${userId}`,
        sessionId: 'sess-1',
        updatedAt: 1,
        expiresAt: 2,
      });
      await ctx.db.insert('loungeMessages', {
        userId,
        userName: 'Vlad',
        content: 'hello',
        date: '2026-10-31',
      });

      const threadId = `thread-${userId}`;
      await ctx.db.insert('threadTitleJobs', { threadId, userId, status: 'pending' });
      await ctx.db.insert('computerCodeRuns', {
        runId: 'code-1',
        userId,
        sessionKey: `${userId}`,
        threadId,
        description: 'demo',
        code: 'console.log(1)',
        status: 'completed',
        stdout: '',
        stderr: '',
        outputTruncated: false,
        startedAt: 1,
        updatedAt: 1,
        expiresAt: 2,
      });

      const runId = await ctx.db.insert('agentRuns', {
        threadId,
        userId,
        model: 'zai/glm-5.3-flash',
        searchEnabled: false,
        status: 'completed',
        stepCount: 1,
        attemptCount: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert('agentRunSteps', {
        runId,
        stepNumber: 0,
        model: 'zai/glm-5.3-flash',
        provider: 'test',
        order: 0,
        stepOrder: 0,
        hasOutput: true,
        hasToolCalls: false,
        toolCallIds: [],
        usage: { totalTokens: 10 },
        createdAt: 1,
      });
      await ctx.db.insert('agentRunSteering', {
        runId,
        requestId: 'req-1',
        text: 'go on',
        status: 'applied',
        createdAt: 1,
      });

      const accountId = await ctx.db.insert('authAccounts', {
        userId,
        provider: 'google',
        providerAccountId: 'google-1',
      });
      await ctx.db.insert('authVerificationCodes', {
        accountId,
        provider: 'google',
        code: '123456',
        expirationTime: 9_999_999_999,
      });
      const sessionId = await ctx.db.insert('authSessions', {
        userId,
        expirationTime: 9_999_999_999,
      });
      await ctx.db.insert('authRefreshTokens', {
        sessionId,
        expirationTime: 9_999_999_999,
      });

      return { threadId, runId, accountId, sessionId };
    });

    // Drive the purge exactly as the action does: repeat until it reports done.
    let done = false;
    let guard = 0;
    while (!done && guard < 10) {
      done = await t.mutation(internal.account.purgeUserBatch, { userId });
      guard += 1;
    }
    expect(done).toBe(true);

    await t.run(async ctx => {
      expect(await ctx.db.get(userId)).toBeNull();
      expect(await ctx.db.get(sessionId)).toBeNull();
      expect(await ctx.db.get(accountId)).toBeNull();
      expect(await ctx.db.get(runId)).toBeNull();

      const remaining = {
        apiKeys: (await ctx.db.query('apiKeys').collect()).filter(r => r.userId === userId),
        notion: (await ctx.db.query('notionConnections').collect()).filter(r => r.userId === userId),
        usage: (await ctx.db.query('usage').collect()).filter(r => r.userId === `${userId}`),
        overage: (await ctx.db.query('meterOverage').collect()).filter(r => r.userId === userId),
        purchases: (await ctx.db.query('storeTransactions').collect()).filter(r => r.userId === userId),
        sessions: (await ctx.db.query('computerUseSessions').collect()).filter(r => r.sessionKey === `${userId}`),
        lounge: (await ctx.db.query('loungeMessages').collect()).filter(r => r.userId === userId),
        steps: (await ctx.db.query('agentRunSteps').collect()).filter(r => r.runId === runId),
        steering: (await ctx.db.query('agentRunSteering').collect()).filter(r => r.runId === runId),
        refresh: (await ctx.db.query('authRefreshTokens').collect()).filter(r => r.sessionId === sessionId),
        verifications: (await ctx.db.query('authVerificationCodes').collect()).filter(r => r.accountId === accountId),
      };
      for (const [table, rows] of Object.entries(remaining)) {
        expect(rows, `${table} should be empty for the deleted user`).toHaveLength(0);
      }

      // A different account's rows must survive untouched.
      const survivor = await ctx.db.get(otherUserId);
      expect(survivor).not.toBeNull();
      const otherKeys = (await ctx.db.query('apiKeys').collect()).filter(
        r => r.userId === otherUserId,
      );
      expect(otherKeys).toHaveLength(1);
    });
  });

  it('clears thread-scoped auxiliary rows without touching other threads', async () => {
    const { t, userId } = await seededAccount();
    const target = 'thread-target';
    const keep = 'thread-keep';

    await t.run(async ctx => {
      for (const threadId of [target, keep]) {
        await ctx.db.insert('threadTitleJobs', { threadId, userId, status: 'pending' });
        await ctx.db.insert('computerCodeRuns', {
          runId: `code-${threadId}`,
          userId,
          sessionKey: `${userId}`,
          threadId,
          description: 'demo',
          code: 'console.log(1)',
          status: 'completed',
          stdout: '',
          stderr: '',
          outputTruncated: false,
          startedAt: 1,
          updatedAt: 1,
          expiresAt: 2,
        });
      }
    });

    await t.mutation(internal.account.clearThreadAux, { userId, threadId: target });

    await t.run(async ctx => {
      const jobs = await ctx.db.query('threadTitleJobs').collect();
      expect(jobs.map(j => j.threadId)).toEqual([keep]);
      const runs = await ctx.db.query('computerCodeRuns').collect();
      expect(runs.map(r => r.threadId)).toEqual([keep]);
    });
  });
});
