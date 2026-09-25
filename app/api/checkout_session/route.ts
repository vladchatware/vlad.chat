import { NextResponse } from 'next/server'
import { fetchAction, fetchQuery } from "convex/nextjs"
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { z } from 'zod'

import { stripe } from '../../../lib/stripe'
import { TOP_UP_PRICE_USD, TOP_UP_TOKENS } from '@/lib/provider'

const checkoutRequestSchema = z.object({
  returnTo: z.enum(['/', '/provider']).optional().default('/'),
}).strict()

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken()
  const user = await fetchQuery(api.users.viewer, {}, { token })
  if (!user || user.isAnonymous) {
    return NextResponse.json({ error: 'Sign in before purchasing credits.' }, { status: 403 })
  }

  const requestBody = await request.json().catch(() => ({}))
  const parsedRequest = checkoutRequestSchema.safeParse(requestBody)
  if (!parsedRequest.success) {
    return NextResponse.json({ error: 'Invalid checkout request.' }, { status: 400 })
  }

  try {
    const stripeId = await fetchAction(api.billing.ensureStripeCustomer, {}, { token })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!siteUrl) {
      return NextResponse.json({ error: 'Missing site URL configuration.' }, { status: 500 })
    }
    const returnUrl = new URL(parsedRequest.data.returnTo, siteUrl)

    const session = await stripe.checkout.sessions.create({
      customer: stripeId,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'AI Tokens'
          },
          unit_amount: TOP_UP_PRICE_USD * 100,
        },
        quantity: 1,
      }],
      payment_method_types: ['card'],
      mode: 'payment',
      success_url: `${returnUrl.toString()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl.toString()}?canceled=true`,
      metadata: { tokens: String(TOP_UP_TOKENS) }
    });
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
