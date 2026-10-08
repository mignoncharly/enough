# Billing

Phase 18 adds a Stripe-backed monthly or annual subscription flow. Product pricing and paid-feature assignments remain unset until willingness-to-pay validation is complete. No amount or paid-feature list is hard-coded in the app.

## Configure Stripe

1. Create recurring Stripe Prices with monthly and/or annual intervals. Set `STRIPE_PRICE_MONTHLY` and/or `STRIPE_PRICE_ANNUAL` to those Price IDs.
2. Set `STRIPE_SECRET_KEY` and one or more comma-separated `STRIPE_WEBHOOK_SECRETS`. Multiple endpoint secrets support secret rotation.
3. Register `POST ${API_BASE_URL}/billing/stripe-webhook` in Stripe. Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalized`, and `invoice.voided`.
4. Enable Stripe Tax and register the applicable tax locations before keeping `STRIPE_AUTOMATIC_TAX=true`. Checkout requires a billing address and collects VAT IDs. Set it to `false` only when tax is handled outside Stripe.
5. Configure the Stripe Customer Portal in the Stripe dashboard with the cancellation and payment-method changes allowed by the product. The app opens the hosted portal; its configuration is controlled in Stripe.
6. Set `STRIPE_TRIAL_DAYS` only after choosing a validated trial offer. The default is zero. When a trial is first offered, it is reserved for that account when Checkout successfully creates a trial session.
7. `BILLING_GRACE_DAYS` controls paid access after a subscription enters `past_due`; the default is three days. Stripe retry, cancellation, and final-unpaid settings should be reviewed with the grace duration.

The account must configure the exact event types and copy the current endpoint signing secret from Stripe. Webhook signatures cover the exact request body, include a five-minute timestamp tolerance, and use constant-time comparison. Stripe events are stored by unique event ID; subscription updates fetch the current Stripe subscription and use event ordering to avoid stale concurrent writes.

## Behavior

- The browser can request only the configured monthly or annual Price ID. Checkout uses Stripe hosted Checkout, allows promotion codes, requires billing address and VAT ID fields, and enables automatic tax according to configuration.
- Successful browser return does not enable access. A verified webhook reconciles subscription state and writes the `paid_features` entitlement.
- Webhook entitlement mapping accepts only the exact `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL` Price IDs. Other recurring Prices and subscription metadata do not grant paid access.
- `active` and `trialing` subscriptions grant the entitlement. A scheduled end-of-period cancellation keeps access through the current period. `past_due` grants access only until its stored grace deadline. Other states do not grant access.
- Checkout is not offered while a subscription is current or in dunning. The Customer Portal handles payment changes and cancellation.
- Invoice webhooks persist amount due, amount paid, tax, invoice URL, status, retry count, and a bounded payment-error summary. Duplicate and older invoice events cannot replace newer state.
- Entitlement reads go through `hasBillingEntitlement` in `apps/api/src/billing.ts`. Product-specific feature-to-entitlement assignments are deliberately not guessed; decide and wire them after pricing and packaging validation.
- Stripe customer IDs and billing records are included in account export. Stripe secrets and webhook payloads are not stored. Account deletion requests Stripe customer deletion before local account deletion; provider failure blocks the local deletion so cleanup can be retried.

Stripe documents customer deletion as irreversible, removing payment details and immediately cancelling active subscriptions. Stripe can still return a limited deleted-customer record to preserve history, so invoice/accounting retention at Stripe may remain. See [Stripe's customer deletion API](https://docs.stripe.com/api/customers/delete).

## Acceptance still required

Apply migrations `0002_authentication.sql` through `0014_privacy.sql` in order. Use Stripe test-mode prices and webhook signing secrets to verify Checkout, a trial and repeat trial attempt, coupon redemption, automatic tax/VAT ID collection, portal cancellation and payment-method changes, duplicate/out-of-order webhooks, active/trialing/past-due/unpaid/canceled transitions, grace expiry, invoice success/failure, ownership isolation, account export/deletion, and the billing UI. Browser, Stripe account configuration, and runtime behavior have not been accepted. No tests or typechecks were run while implementing this phase.
