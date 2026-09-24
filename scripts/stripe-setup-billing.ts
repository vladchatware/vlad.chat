/**
 * One-time Stripe setup for the subscription billing build. Idempotent:
 * safe to re-run, reuses existing meter / product / prices / portal config.
 *
 * Run: bun scripts/stripe-setup-billing.ts   (with STRIPE_SECRET_KEY in env)
 * Prints only resource IDs — never the key.
 */
import Stripe from "stripe";
import {
  OVERAGE_METER_EVENT_NAME,
  SUBSCRIPTION_PRICE_NICKNAME,
  SUBSCRIPTION_PRICE_USD,
} from "../lib/billing";

const OVERAGE_LOOKUP_KEY = "vladchat-overage-metered";
const MONTHLY_LOOKUP_KEY = "vladchat-monthly";
const PRODUCT_NAME = "VLAD.CHAT Subscription";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY not set — source it from the repo env config.");
  process.exit(1);
}
const stripe = new Stripe(key);

async function ensureMeter(): Promise<string> {
  for await (const meter of stripe.billing.meters.list({ limit: 100 })) {
    if (meter.event_name === OVERAGE_METER_EVENT_NAME) {
      console.log(`meter exists: ${meter.id} (${meter.event_name})`);
      return meter.id;
    }
  }
  const meter = await stripe.billing.meters.create({
    display_name: "VLAD.CHAT credit overage",
    event_name: OVERAGE_METER_EVENT_NAME,
    default_aggregation: { formula: "sum" },
    // event payload carries `value` (credits) and `stripe_customer_id`
    value_settings: { event_payload_key: "value" },
    customer_mapping: { event_payload_key: "stripe_customer_id", type: "by_id" },
  });
  console.log(`meter created: ${meter.id} (${meter.event_name})`);
  return meter.id;
}

async function ensureProduct(): Promise<string> {
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.name === PRODUCT_NAME) {
      console.log(`product exists: ${product.id}`);
      return product.id;
    }
  }
  const product = await stripe.products.create({
    name: PRODUCT_NAME,
    statement_descriptor: "VLAD.CHAT SUB",
  });
  console.log(`product created: ${product.id}`);
  return product.id;
}

async function ensurePrice(
  productId: string,
  opts: {
    lookupKey: string;
    /** integer cents (flat prices) */
    unitAmount?: number;
    /** decimal string in cents for sub-cent per-unit metered pricing */
    unitAmountDecimal?: string;
    meter?: string;
    nickname?: string;
  },
): Promise<string> {
  const existing = await stripe.prices.list({ lookup_keys: [opts.lookupKey], active: true });
  if (existing.data.length > 0) {
    console.log(`price exists: ${existing.data[0].id} (${opts.lookupKey})`);
    return existing.data[0].id;
  }
  const recurring = opts.meter
    ? { interval: "month" as const, meter: opts.meter, usage_type: "metered" as const }
    : { interval: "month" as const };
  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    ...(opts.unitAmount !== undefined
      ? { unit_amount: opts.unitAmount }
      : { unit_amount_decimal: opts.unitAmountDecimal }),
    nickname: opts.nickname,
    recurring,
    lookup_key: opts.lookupKey,
    transfer_lookup_key: true,
  });
  console.log(`price created: ${price.id} (${opts.lookupKey})`);
  return price.id;
}

async function ensurePortalConfig(productId: string, monthlyPriceId: string): Promise<string> {
  for await (const config of stripe.billingPortal.configurations.list({ limit: 100 })) {
    const hasOurProduct = config.features.subscription_update?.products?.some(
      (p) => p.product === productId,
    );
    if (hasOurProduct) {
      console.log(`portal config exists: ${config.id}`);
      return config.id;
    }
  }
  const config = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Manage your VLAD.CHAT subscription.",
    },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price", "quantity", "promotion_code"],
        products: [{ product: productId, prices: [monthlyPriceId] }],
      },
    },
  });
  console.log(`portal config created: ${config.id}`);
  return config.id;
}

const meterId = await ensureMeter();
const productId = await ensureProduct();
// $5/mo flat = 500 cents
const monthlyPriceId = await ensurePrice(productId, {
  lookupKey: MONTHLY_LOOKUP_KEY,
  unitAmount: 500,
  nickname: `${SUBSCRIPTION_PRICE_NICKNAME} ($${SUBSCRIPTION_PRICE_USD}/mo)`,
});
// metered per-unit: $0.30 per 1M credits = $0.0000003/credit = 0.0003 cents/credit
const overagePriceId = await ensurePrice(productId, {
  lookupKey: OVERAGE_LOOKUP_KEY,
  unitAmountDecimal: "0.0003",
  meter: meterId,
  nickname: "Overage (metered credits)",
});
const portalConfigId = await ensurePortalConfig(productId, monthlyPriceId);

console.log("\n--- summary ---");
console.log(`STRIPE_METER_ID=${meterId}`);
console.log(`STRIPE_PRODUCT_ID=${productId}`);
console.log(`STRIPE_MONTHLY_PRICE_ID=${monthlyPriceId}`);
console.log(`STRIPE_OVERAGE_PRICE_ID=${overagePriceId}`);
console.log(`STRIPE_PORTAL_CONFIG_ID=${portalConfigId}`);
