import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';

const modules = {
  './users.ts': () => import('./users'),
  './_generated/server.ts': () => import('./_generated/server'),
};

async function account(fields: Partial<Doc<'users'>> = {}) {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx =>
    ctx.db.insert('users', { trialTokens: 16_000_000, ...fields }),
  );
  return { t, id, auth: t.withIdentity({ subject: `${id}|session` }) };
}

const freeModel = 'zai/glm-5.3-flash';
const premiumModel = 'anthropic/claude-opus-5.5';
const usage = (totalTokens: number) => ({ totalTokens });

describe('usageGate admission (real handler)', () => {
  it('rejects anonymous premium access before anonymous trial admission', async () => {
    const { auth } = await account({ isAnonymous: true, trialMessages: 10 });
    await expect(
      auth.mutation(api.users.usageGate, { model: premiumModel }),
    ).rejects.toThrow(/subscription/);
  });

  it('rejects unknown models', async () => {
    const { auth } = await account();
    await expect(
      auth.mutation(api.users.usageGate, { model: 'unlisted/model' }),
    ).rejects.toThrow(/unavailable/);
  });

  it('admits subscriber premium models (enabled:false is premium, not disabled)', async () => {
    const { auth } = await account({
      subscriptionStatus: 'active',
      includedCredits: 1_000_000,
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
    });
    await expect(
      auth.mutation(api.users.usageGate, { model: premiumModel }),
    ).resolves.toBeNull();
  });

  it('blocks non-subscriber premium models even with balance', async () => {
    const { auth } = await account({ tokens: 1_000_000 });
    await expect(
      auth.mutation(api.users.usageGate, { model: premiumModel }),
    ).rejects.toThrow(/subscription/);
  });

  it('blocks a user with no balances and no subscription', async () => {
    const { auth } = await account({
      trialTokens: 0,
      tokens: 0,
      subscriptionStatus: 'canceled',
    });
    await expect(
      auth.mutation(api.users.usageGate, { model: freeModel }),
    ).rejects.toThrow(/out of credits/);
  });

  it('subscriber past their (4x) cap is rejected at admission with a plan message', async () => {
    const { t, id, auth } = await account({
      subscriptionStatus: 'active',
      includedCredits: 100_000_000,
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
    });
    // 4 x 2M credits 6h ago = 8M inside the weekly window (= 8M subscriber
    // weekly cap) while the 5-hour window stays empty.
    await t.run(async ctx => {
      for (let i = 0; i < 4; i++) {
        await ctx.db.insert('usage', {
          userId: id,
          model: freeModel,
          provider: 'test',
          usage: usage(2_000_000),
          credits: 2_000_000,
          usageTime: Date.now() - 6 * 60 * 60 * 1000,
        });
      }
    });
    await expect(
      auth.mutation(api.users.usageGate, { model: freeModel }),
    ).rejects.toThrow(/weekly usage cap for your plan/);
  });

  it('free user past the weekly cap is rejected at admission', async () => {
    const { t, id, auth } = await account({ trialTokens: 100_000_000 });
    // 2M credits 6h ago hits the 2M free weekly cap; the 5-hour window stays
    // empty so the weekly message is the one that fires.
    await t.run(async ctx => {
      await ctx.db.insert('usage', {
        userId: id,
        model: freeModel,
        provider: 'test',
        usage: usage(2_000_000),
        credits: 2_000_000,
        usageTime: Date.now() - 6 * 60 * 60 * 1000,
      });
    });
    await expect(
      auth.mutation(api.users.usageGate, { model: freeModel }),
    ).rejects.toThrow(/free weekly usage cap/);
  });
});

describe('recordUsage settlement (real handler)', () => {
  it('settlement always records usage even when balances are exhausted', async () => {
    const { t, id, auth } = await account({
      trialTokens: 0,
      subscriptionStatus: 'active',
      includedCredits: 0,
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
    });
    await auth.mutation(api.users.usage, {
      model: freeModel,
      provider: 'test',
      usage: usage(1000),
    });
    const [user, rows, overage] = await t.run(async ctx => [
      await ctx.db.get(id),
      await ctx.db.query('usage').withIndex('byUserTime', q => q.eq('userId', id)).collect(),
      await ctx.db.query('meterOverage').collect(),
    ]);
    // Work already done upstream is never discarded.
    expect(rows.length).toBe(1);
    expect(rows[0].credits).toBe(1000);
    // The uncovered remainder is metered for the subscriber, not dropped.
    expect(overage.length).toBe(1);
    expect(overage[0].credits).toBe(1000);
    expect(overage[0].status).toBe('pending');
    expect(overage[0].queuedAt).toBeTypeOf('number');
    expect(user?.includedCredits).toBe(0);
  });

  it('trial covers raw tokens first; only the shortfall converts to weighted credits', async () => {
    const { t, id, auth } = await account({ trialTokens: 50, includedCredits: 16_000_000 });
    await auth.mutation(api.users.usage, {
      model: freeModel,
      provider: 'test',
      usage: usage(100),
    });
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.trialTokens).toBe(0);
    // 50 raw shortfall at weight 1 = 50 credits from the 16M grant.
    expect(user?.includedCredits).toBe(16_000_000 - 50);
    const overage = await t.run(ctx => ctx.db.query('meterOverage').collect());
    expect(overage.length).toBe(0);
  });

  it('grant is consumed before prepaid (prepaid is a buffer, not a co-payer)', async () => {
    const { t, id, auth } = await account({
      trialTokens: 0,
      subscriptionStatus: 'active',
      includedCredits: 60,
      tokens: 1000,
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
    });
    await auth.mutation(api.users.usage, {
      model: freeModel,
      provider: 'test',
      usage: usage(100),
    });
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.includedCredits).toBe(0); // 60 weighted used up
    expect(user?.tokens).toBe(960); // remaining 40 weighted from prepaid
    const overage = await t.run(ctx => ctx.db.query('meterOverage').collect());
    expect(overage.length).toBe(0); // prepaid covered the rest — no double bill
  });

  it('non-subscriber overage is not metered (no Stripe debt for free users)', async () => {
    const { t, id, auth } = await account({
      trialTokens: 0,
      includedCredits: 0,
      tokens: 0,
      subscriptionStatus: 'canceled',
    });
    // Gate would block a new request, but a settlement that still arrives
    // (e.g. raced admission) must record without creating a Stripe row.
    await auth.mutation(api.users.usage, {
      model: freeModel,
      provider: 'test',
      usage: usage(500),
    });
    const overage = await t.run(ctx => ctx.db.query('meterOverage').collect());
    const rows = await t.run(ctx =>
      ctx.db.query('usage').withIndex('byUserTime', q => q.eq('userId', id)).collect(),
    );
    expect(rows.length).toBe(1);
    expect(overage.length).toBe(0);
  });
});

describe('subscription webhook identity (real handler)', () => {
  it('ignores stale cancellation for an older subscription', async () => {
    const { t, id } = await account({
      subscriptionStatus: 'active',
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_new',
      includedCredits: 8_000_000,
    });
    await t.run(ctx =>
      ctx.runMutation(internal.users.applySubscriptionWebhook, {
        eventId: 'evt_old_del',
        stripeId: 'cus_x',
        action: 'cancel',
        subscriptionId: 'sub_old',
      }),
    );
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.subscriptionStatus).toBe('active');
    expect(user?.includedCredits).toBe(8_000_000);
  });

  it('applies genuine cancellation of the current subscription', async () => {
    const { t, id } = await account({
      subscriptionStatus: 'active',
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_new',
      includedCredits: 8_000_000,
    });
    await t.run(ctx =>
      ctx.runMutation(internal.users.applySubscriptionWebhook, {
        eventId: 'evt_new_del',
        stripeId: 'cus_x',
        action: 'cancel',
        subscriptionId: 'sub_new',
      }),
    );
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.subscriptionStatus).toBe('canceled');
    expect(user?.includedCredits).toBe(0);
  });

  it('paid renewal restores a past_due subscription to active and re-grants additively', async () => {
    const { t, id } = await account({
      subscriptionStatus: 'past_due',
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
      includedCredits: 1_000_000,
    });
    await t.run(ctx =>
      ctx.runMutation(internal.users.applySubscriptionWebhook, {
        eventId: 'evt_renewal',
        stripeId: 'cus_x',
        action: 'activate',
        subscriptionId: 'sub_x',
        grantCredits: 16_000_000,
      }),
    );
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.subscriptionStatus).toBe('active');
    expect(user?.includedCredits).toBe(17_000_000);
  });

  it('renewal naming a foreign subscription never overwrites the locally-known id', async () => {
    const { t, id } = await account({
      subscriptionStatus: 'active',
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_known',
      includedCredits: 1_000_000,
    });
    await t.run(ctx =>
      ctx.runMutation(internal.users.applySubscriptionWebhook, {
        eventId: 'evt_foreign_renewal',
        stripeId: 'cus_x',
        action: 'activate',
        subscriptionId: 'sub_foreign',
        grantCredits: 16_000_000,
      }),
    );
    const user = await t.run(ctx => ctx.db.get(id));
    // User is active with a known subscription: the renewal branch must keep
    // the known identity, not adopt the foreign id.
    expect(user?.stripeSubscriptionId).toBe('sub_known');
    expect(user?.subscriptionStatus).toBe('active');
  });

  it('a genuinely new subscription (user not active) is adopted with a fresh period', async () => {
    const { t, id } = await account({
      subscriptionStatus: 'canceled',
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_old',
      includedCredits: 0,
    });
    await t.run(ctx =>
      ctx.runMutation(internal.users.applySubscriptionWebhook, {
        eventId: 'evt_resub',
        stripeId: 'cus_x',
        action: 'activate',
        subscriptionId: 'sub_fresh',
        grantCredits: 16_000_000,
      }),
    );
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.subscriptionStatus).toBe('active');
    expect(user?.stripeSubscriptionId).toBe('sub_fresh');
    expect(user?.includedCredits).toBe(16_000_000);
    expect(user?.grantPeriodStart).toBeTypeOf('number');
  });

  it('is idempotent per Stripe event id', async () => {
    const { t, id } = await account({
      stripeId: 'cus_x',
      stripeSubscriptionId: 'sub_x',
    });
    const run = (eventId: string) =>
      t.run(ctx =>
        ctx.runMutation(internal.users.applySubscriptionWebhook, {
          eventId,
          stripeId: 'cus_x',
          action: 'activate',
          subscriptionId: 'sub_x',
          grantCredits: 16_000_000,
        }),
      );
    await run('evt_same');
    await run('evt_same');
    const user = await t.run(ctx => ctx.db.get(id));
    expect(user?.includedCredits).toBe(16_000_000);
  });
});

describe('checkout reservation (real handler)', () => {
  it('blocks a second concurrent checkout', async () => {
    const { auth } = await account();
    await auth.mutation(api.users.reserveCheckout, { marker: 'marker-1' });
    await expect(
      auth.mutation(api.users.reserveCheckout, { marker: 'marker-2' }),
    ).rejects.toThrow(/already in progress/);
  });

  it('same-marker re-reservation is idempotent', async () => {
    const { auth } = await account();
    await auth.mutation(api.users.reserveCheckout, { marker: 'marker-1' });
    await expect(
      auth.mutation(api.users.reserveCheckout, { marker: 'marker-1' }),
    ).resolves.toBeNull();
  });

  it('stale (>24h) reservations are overwritable', async () => {
    const { t, id, auth } = await account();
    await t.run(ctx =>
      ctx.db.patch(id, {
        pendingCheckoutSessionId: 'old-marker',
        pendingCheckoutAt: Date.now() - 25 * 60 * 60 * 1000,
      }),
    );
    await expect(
      auth.mutation(api.users.reserveCheckout, { marker: 'marker-new' }),
    ).resolves.toBeNull();
  });

  it('owner can release; a non-owner release is a no-op', async () => {
    const { t, id, auth } = await account();
    await auth.mutation(api.users.reserveCheckout, { marker: 'marker-1' });
    await auth.mutation(api.users.releaseCheckout, { marker: 'not-owner' });
    let user = await t.run(ctx => ctx.db.get(id));
    expect(user?.pendingCheckoutSessionId).toBe('marker-1');
    await auth.mutation(api.users.releaseCheckout, { marker: 'marker-1' });
    user = await t.run(ctx => ctx.db.get(id));
    expect(user?.pendingCheckoutSessionId).toBeUndefined();
  });

  it('stripe-keyed clear only clears the matching marker; markerless clear always clears', async () => {
    const { t, id, auth } = await account({ stripeId: 'cus_x' });
    await auth.mutation(api.users.reserveCheckout, { marker: 'marker-1' });
    await t.run(ctx =>
      ctx.runMutation(internal.users.clearCheckoutReservation, {
        stripeId: 'cus_x',
        marker: 'wrong-marker',
      }),
    );
    let user = await t.run(ctx => ctx.db.get(id));
    expect(user?.pendingCheckoutSessionId).toBe('marker-1');
    await t.run(ctx =>
      ctx.runMutation(internal.users.clearCheckoutReservation, {
        stripeId: 'cus_x',
        marker: 'marker-1',
      }),
    );
    user = await t.run(ctx => ctx.db.get(id));
    expect(user?.pendingCheckoutSessionId).toBeUndefined();
    await auth.mutation(api.users.reserveCheckout, { marker: 'marker-2' });
    await t.run(ctx =>
      ctx.runMutation(internal.users.clearCheckoutReservation, { stripeId: 'cus_x' }),
    );
    user = await t.run(ctx => ctx.db.get(id));
    expect(user?.pendingCheckoutSessionId).toBeUndefined();
  });
});
