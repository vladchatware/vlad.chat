import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import Stripe from "stripe";
import { internal } from "./_generated/api";
import { TOP_UP_PRICE_USD, TOP_UP_TOKENS } from "@/lib/provider";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const webhook_secret = process.env.STRIPE_WEBHOOK_SECRET

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: '/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get('stripe-signature')
    try {
      const payload = await req.text()
      const event = await stripe.webhooks.constructEventAsync(payload, signature, webhook_secret)

      switch (event.type) {
        case 'checkout.session.completed':
          const customer = event.data.object.customer
          const stripeId =
            typeof customer === 'string' ? customer : customer?.id
          const tokens = Number(event.data.object.metadata?.tokens)
          if (
            !stripeId ||
            tokens !== TOP_UP_TOKENS ||
            event.data.object.payment_status !== 'paid' ||
            event.data.object.currency !== 'usd' ||
            event.data.object.amount_total !== TOP_UP_PRICE_USD * 100
          ) {
            throw new Error("Checkout session does not match paid credit pack.")
          }
          await ctx.runMutation(internal.users.topup, {
            eventId: event.id,
            stripeId,
            tokens: TOP_UP_TOKENS,
          })
          break;
        default:
          console.log(event.type)
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Stripe webhook failed.")
      return new Response(null, { status: 400 })
    }
    return new Response(null, { status: 200 })
  })
})

export default http;
