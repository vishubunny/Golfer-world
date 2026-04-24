import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";

export const runtime = "nodejs"; // need raw body

/**
 * Stripe webhook — single source of truth for subscription state.
 * Configure endpoint in Stripe dashboard → set STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const body = await req.text();

  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!); }
  catch (err: any) { return NextResponse.json({ error: `Bad signature: ${err.message}` }, { status: 400 }); }

  const supabase = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.user_id;
      const plan   = s.metadata?.plan as "monthly" | "yearly";
      if (!userId || !s.subscription) break;
      const sub = await stripe.subscriptions.retrieve(s.subscription as string);
      await supabase.from("subscriptions").upsert({
        user_id: userId, plan, status: "active",
        amount_cents: sub.items.data[0]?.price.unit_amount ?? 0,
        stripe_customer_id: s.customer as string,
        stripe_subscription_id: sub.id,
        current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
        current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end
      }, { onConflict: "stripe_subscription_id" });
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const status = sub.status === "active" ? "active" : sub.status === "canceled" ? "cancelled" : "lapsed";
      await supabase.from("subscriptions")
        .update({
          status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end
        })
        .eq("stripe_subscription_id", sub.id);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await supabase.from("subscriptions").update({ status: "cancelled" }).eq("stripe_subscription_id", sub.id);
      break;
    }
  }
  return NextResponse.json({ received: true });
}
