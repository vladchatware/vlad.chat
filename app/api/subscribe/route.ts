import { NextResponse } from 'next/server'
import { fetchAction, fetchQuery } from "convex/nextjs"
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';

import { stripe } from '../../../lib/stripe'
import { SUBSCRIPTION_PRICE_NICKNAME } from '@/lib/billing'
import { api } from '@/convex/_generated/api';

const returnPaths = ['/', '/provider'] as const;

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken()
  const user = await fetchQuery(api.users.viewer, {}, { token })
  if (!user || user.isAnonymous) {
    return NextResponse.json({ error: 'Sign in before subscribing.' }, { status: 403 })
  }
  if (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due') {
    return NextResponse.json({ error: 'You already have a subscription.' }, { status: 409 })
  }

  try {
    const stripeId = await fetchAction(api.billing.ensureStripeCustomer, {}, { token })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!siteUrl) {
      return NextResponse.json({ error: 'Missing site URL configuration.' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const requested = typeof body?.returnTo === 'string' ? body.returnTo : '/'
    const returnTo = (returnPaths as readonly string[]).includes(requested) ? requested : '/'
    const returnUrl = new URL(returnTo, siteUrl)

    // Prices are looked up by nickname so nothing environment-specific is hardcoded.
    const prices = await stripe.prices.list({
      lookup_keys: [SUBSCRIPTION_PRICE_NICKNAME],
      expand: ['data.currency_options'],
    })
    const price = prices.data[0]
    if (!price) {
      return NextResponse.json({ error: 'Subscription plan is not configured.' }, { status: 500 })
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeId,
      line_items: [{ price: price.id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${returnUrl.toString()}?subscription=success`,
      cancel_url: `${returnUrl.toString()}?subscription=canceled`,
      subscription_data: { metadata: { userId: user._id } },
      metadata: { kind: 'vladchat-subscription' },
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.log(err)
    const message = err instanceof Error ? err.message : 'Checkout failed.'
    const status =
      typeof err === 'object' && err !== null && 'statusCode' in err &&
      typeof err.statusCode === 'number'
        ? err.statusCode
        : 500
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}
