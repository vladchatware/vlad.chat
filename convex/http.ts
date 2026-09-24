import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import Stripe from "stripe";
import { internal } from "./_generated/api";
import { TOP_UP_PRICE_USD, TOP_UP_TOKENS } from "@/lib/provider";
import { SUBSCRIPTION_GRANT_CREDITS } from "@/lib/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const webhook_secret = process.env.STRIPE_WEBHOOK_SECRET

function stripeIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) {
  return typeof customer === "string" ? customer : customer?.id;
}

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
        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.mode === "subscription") {
            // Subscription signups grant their first monthly credits here;
            // renewals arrive via invoice.paid.
            const stripeId = stripeIdOf(session.customer);
            if (!stripeId) throw new Error("Subscription checkout missing customer.");
            await ctx.runMutation(internal.users.applySubscriptionWebhook, {
              eventId: event.id,
              stripeId,
              action: "activate",
              subscriptionId:
                typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
              grantCredits: SUBSCRIPTION_GRANT_CREDITS,
            });
            break;
          }

          const customer = session.customer
          const stripeId =
            typeof customer === 'string' ? customer : customer?.id
          const tokens = Number(session.metadata?.tokens)
          if (
            !stripeId ||
            tokens !== TOP_UP_TOKENS ||
            session.payment_status !== 'paid' ||
            session.currency !== 'usd' ||
            session.amount_total !== TOP_UP_PRICE_USD * 100
          ) {
            throw new Error("Checkout session does not match paid credit pack.")
          }
          await ctx.runMutation(internal.users.topup, {
            eventId: event.id,
            stripeId,
            tokens: TOP_UP_TOKENS,
          })
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object;
          // stripe@19 API: subscription lives under parent.subscription_details.
          const parent = invoice.parent;
          const subscriptionId =
            parent?.type === "subscription_details"
              ? typeof parent.subscription_details.subscription === "string"
                ? parent.subscription_details.subscription
                : parent.subscription_details.subscription?.id
              : null;
          if (!subscriptionId) break; // One-time invoices (top-ups) don't re-grant.
          // The initial subscription invoice is already granted by
          // checkout.session.completed; granting here too would double-grant.
          // Only renewal invoices (billing_reason != subscription_create)
          // re-grant. billing_reason is absent on very old API versions, in
          // which case renewal invoices are identified by a prior period.
          const billingReason =
            (invoice as { billing_reason?: string | null }).billing_reason ?? null;
          const priorPeriodEnd = invoice.lines?.data?.[0]?.period?.end;
          const isInitialInvoice =
            billingReason === "subscription_create" ||
            (billingReason === null && priorPeriodEnd === undefined);
          if (isInitialInvoice) break;
          const stripeId = stripeIdOf(invoice.customer);
          if (!stripeId) throw new Error("Subscription invoice missing customer.");
          await ctx.runMutation(internal.users.applySubscriptionWebhook, {
            eventId: event.id,
            stripeId,
            action: "activate",
            subscriptionId,
            grantCredits: SUBSCRIPTION_GRANT_CREDITS,
          });
          break;
        }
        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          const parent = invoice.parent;
          const subscriptionId =
            parent?.type === "subscription_details"
              ? typeof parent.subscription_details.subscription === "string"
                ? parent.subscription_details.subscription
                : parent.subscription_details.subscription?.id
              : null;
          if (!subscriptionId) break;
          const stripeId = stripeIdOf(invoice.customer);
          if (!stripeId) throw new Error("Failed invoice missing customer.");
          await ctx.runMutation(internal.users.applySubscriptionWebhook, {
            eventId: event.id,
            stripeId,
            action: "past_due",
          });
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const stripeId = stripeIdOf(subscription.customer);
          if (!stripeId) throw new Error("Subscription deletion missing customer.");
          await ctx.runMutation(internal.users.applySubscriptionWebhook, {
            eventId: event.id,
            stripeId,
            action: "cancel",
            subscriptionId: subscription.id,
          });
          break;
        }
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
