import { NextResponse } from 'next/server'
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs"
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';

import { stripe } from '../../../lib/stripe'
import { OVERAGE_PRICE_NICKNAME, SUBSCRIPTION_PRICE_NICKNAME } from '@/lib/billing'
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
    const [prices, overagePrices] = await Promise.all([
      stripe.prices.list({
        lookup_keys: [SUBSCRIPTION_PRICE_NICKNAME],
        expand: ['data.currency_options'],
      }),
      stripe.prices.list({ lookup_keys: [OVERAGE_PRICE_NICKNAME] }),
    ])
    const price = prices.data[0]
    const overagePrice = overagePrices.data[0]
    if (!price || !overagePrice) {
      return NextResponse.json({ error: 'Subscription plan is not configured.' }, { status: 500 })
    }

    // Fail closed on a misconfigured catalog rather than charging the wrong
    // rate: the flat price must be exactly $5/month USD and the metered price
    // exactly $0.30 per 1M credits.
    if (
      price.unit_amount !== 500 ||
      price.currency !== 'usd' ||
      Number(overagePrice.unit_amount_decimal) !== 0.00003 ||
      overagePrice.currency !== 'usd'
    ) {
      return NextResponse.json({ error: 'Subscription plan is misconfigured.' }, { status: 503 })
    }

    // Reserve the single checkout slot before creating the session; the marker
    // rides along as client_reference_id so webhook events can identify the
    // reservation they belong to.
    const marker = crypto.randomUUID()
    try {
      await fetchMutation(api.users.reserveCheckout, { marker }, { token })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('checkout is already in progress')) {
        return NextResponse.json({ error: message }, { status: 409 })
      }
      throw err
    }

    try {
      // Attach the metered overage price alongside the flat price so meter
      // events actually invoice. Metered items take no quantity.
      const session = await stripe.checkout.sessions.create({
        customer: stripeId,
        client_reference_id: marker,
        line_items: [
          { price: price.id, quantity: 1 },
          { price: overagePrice.id },
        ],
        mode: 'subscription',
        success_url: `${returnUrl.toString()}?subscription=success`,
        cancel_url: `${returnUrl.toString()}?subscription=canceled`,
        subscription_data: { metadata: { userId: user._id } },
        metadata: { kind: 'vladchat-subscription' },
      })
      return NextResponse.json({ url: session.url })
    } catch (err) {
      // Session creation failed — release the slot so the user can retry.
      await fetchMutation(api.users.releaseCheckout, { marker }, { token }).catch(() => {})
      throw err
    }
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
