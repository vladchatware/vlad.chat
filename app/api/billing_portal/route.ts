import { NextResponse } from 'next/server'
import { fetchAction, fetchQuery } from "convex/nextjs"
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';

import { stripe } from '../../../lib/stripe'
import { api } from '@/convex/_generated/api';

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken()
  const user = await fetchQuery(api.users.viewer, {}, { token })
  if (!user || user.isAnonymous) {
    return NextResponse.json({ error: 'Sign in to manage billing.' }, { status: 403 })
  }
  if (!user.stripeId) {
    return NextResponse.json({ error: 'No billing profile yet. Subscribe or top up first.' }, { status: 409 })
  }

  try {
    const stripeId = await fetchAction(api.billing.ensureStripeCustomer, {}, { token })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (!siteUrl) {
      return NextResponse.json({ error: 'Missing site URL configuration.' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const requested = typeof body?.returnTo === 'string' ? body.returnTo : '/'
    const returnTo = requested === '/provider' ? '/provider' : '/'
    const returnUrl = new URL(returnTo, siteUrl)

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeId,
      return_url: returnUrl.toString(),
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.log(err)
    const message = err instanceof Error ? err.message : 'Could not open billing portal.'
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
