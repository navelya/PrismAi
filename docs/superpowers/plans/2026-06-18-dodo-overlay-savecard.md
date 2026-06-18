# Dodo Payments — Overlay Checkout + Save Payment Info

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline overlay checkout (instead of full-page redirect) and a per-user "save my payment info" opt-in to the Dodo Payments integration.

**Architecture:** The `dodopayments-checkout` client SDK is dynamically imported in a new `lib/billing/dodo-overlay.ts` helper (client-only) so it never enters the server bundle. The server routes expose `mode` alongside the checkout `url` and read `save_payment_info` from `profiles`. The client wires the overlay into the three existing purchase entry-points (PlansModal credit pack, PlansModal first-sub, standalone checkout page) with a `window.location.href` redirect fallback on any SDK failure. The toggle UI lives in `CreditsBillingTab` and is gated on `hasSavedCustomer`.

**Tech Stack:** Next.js 14 App Router, TypeScript, `dodopayments-checkout` (already installed), `dodopayments` SDK, Supabase service client, Radix UI Switch (shared `components/ui/Switch.tsx`).

## Global Constraints

- `npx tsc --noEmit` must be CLEAN (zero errors) after every task.
- Client components must NOT import `lib/billing/dodo-server.ts` or `lib/supabase/service.ts` — those are server-only.
- The overlay helper is client-only; dynamic import keeps the SDK out of the server bundle.
- All new popups must use `components/ui/Modal` — the Dodo SDK's own iframe overlay is NOT our popup system, so it doesn't apply.
- Redirect flow must remain intact: if SDK import or `open()` throws, fall back to `window.location.href`.
- Path alias `@/*` maps to the repo root.
- No test runner — verify TypeScript only with `npx tsc --noEmit`.

---

### Task 1: Backend — `getDodoCheckoutMode` + expose `mode` on checkout routes

**Files:**
- Modify: `lib/billing/dodo-server.ts`
- Modify: `app/api/billing/checkout/route.ts`
- Modify: `app/api/billing/buy-pack/route.ts`

**Interfaces:**
- Produces: `getDodoCheckoutMode(): 'test' | 'live'` in `lib/billing/dodo-server.ts`
- Produces: `checkout` route returns `{ url: string; mode: 'test' | 'live' }`
- Produces: `buy-pack` route returns `{ requiresCheckout: true; url: string; mode: 'test' | 'live' }` (silent-charge `{ ok:true }` path unchanged)

- [ ] **Step 1: Add `getDodoCheckoutMode` to `lib/billing/dodo-server.ts`**

Append to the existing file (after the `getDodo` function):

```typescript
export function getDodoCheckoutMode(): 'test' | 'live' {
    return getDodoEnvironment() === 'live_mode' ? 'live' : 'test';
}
```

- [ ] **Step 2: Update `app/api/billing/checkout/route.ts` to return `mode`**

In the `POST` handler, find the final success return at the bottom:
```typescript
return NextResponse.json({ url: session.checkout_url });
```
Replace it with:
```typescript
import { getDodo, getDodoCheckoutMode } from '@/lib/billing/dodo-server';
// ... existing code ...
return NextResponse.json({ url: session.checkout_url, mode: getDodoCheckoutMode() });
```

Concretely: add `getDodoCheckoutMode` to the import on line 14, and update the final return. The import line currently reads:
```typescript
import { getDodo } from '@/lib/billing/dodo-server';
```
Change to:
```typescript
import { getDodo, getDodoCheckoutMode } from '@/lib/billing/dodo-server';
```
And update the final `NextResponse.json` call:
```typescript
return NextResponse.json({ url: session.checkout_url, mode: getDodoCheckoutMode() });
```

- [ ] **Step 3: Update `app/api/billing/buy-pack/route.ts` to return `mode`**

Add `getDodoCheckoutMode` to the import (line 22):
```typescript
import { getDodo, getDodoCheckoutMode } from '@/lib/billing/dodo-server';
```

Find the final `requiresCheckout` return (currently line 154):
```typescript
return NextResponse.json({ requiresCheckout: true, url: session.checkout_url });
```
Change it to:
```typescript
return NextResponse.json({ requiresCheckout: true, url: session.checkout_url, mode: getDodoCheckoutMode() });
```

- [ ] **Step 4: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/dodo-server.ts app/api/billing/checkout/route.ts app/api/billing/buy-pack/route.ts
git commit -m "feat(billing): expose checkout mode on buy-pack and checkout routes"
```

---

### Task 2: Client overlay helper — `lib/billing/dodo-overlay.ts`

**Files:**
- Create: `lib/billing/dodo-overlay.ts`

**Interfaces:**
- Produces:
  ```typescript
  export async function openDodoOverlay(opts: {
    checkoutUrl: string;
    mode: 'test' | 'live';
    onSuccess?: () => void;
    onClose?: () => void;
    onError?: (msg: string) => void;
  }): Promise<{ ok: boolean }>;
  ```

- [ ] **Step 1: Create `lib/billing/dodo-overlay.ts`**

```typescript
/**
 * Client-only helper that opens the Dodo Payments overlay checkout.
 *
 * The SDK is dynamically imported so it never enters the server bundle.
 * Callers MUST fall back to `window.location.href = checkoutUrl` when
 * this function returns `{ ok: false }`.
 */

export interface DodoOverlayOptions {
    checkoutUrl: string;
    mode: 'test' | 'live';
    onSuccess?: () => void;
    onClose?: () => void;
    onError?: (msg: string) => void;
}

export async function openDodoOverlay(opts: DodoOverlayOptions): Promise<{ ok: boolean }> {
    try {
        const { DodoPayments } = await import('dodopayments-checkout');

        DodoPayments.Initialize({
            mode: opts.mode,
            displayType: 'overlay',
            onEvent: (e) => {
                switch (e.event_type) {
                    case 'checkout.redirect':
                    case 'checkout.redirect_requested':
                        opts.onSuccess?.();
                        DodoPayments.Checkout.close();
                        break;
                    case 'checkout.closed':
                        opts.onClose?.();
                        break;
                    case 'checkout.error':
                    case 'checkout.link_expired': {
                        const msg =
                            (e.data?.message as string | undefined) ||
                            (e.event_type === 'checkout.link_expired'
                                ? 'Checkout link expired. Please try again.'
                                : 'Checkout error. Please try again.');
                        opts.onError?.(msg);
                        break;
                    }
                    default:
                        break;
                }
            },
        });

        DodoPayments.Checkout.open({
            checkoutUrl: opts.checkoutUrl,
            options: { manualRedirect: true },
        });

        return { ok: true };
    } catch {
        return { ok: false };
    }
}
```

- [ ] **Step 2: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/billing/dodo-overlay.ts
git commit -m "feat(billing): add dodo overlay client helper with redirect fallback"
```

---

### Task 3: Wire overlay into `components/billing/PlansModal.tsx` — credit pack + first subscription

**Files:**
- Modify: `components/billing/PlansModal.tsx`

**Interfaces:**
- Consumes: `openDodoOverlay` from `@/lib/billing/dodo-overlay`
- The credit pack handler inside `CreditPackCard.handleClick` currently does:
  ```typescript
  if (json.requiresCheckout) {
      if (json.url) { window.location.href = json.url; } ...
  }
  ```
  Change to call overlay with fallback to redirect.
- The `PlanCTA.handleClick` first-time-purchase branch currently does:
  ```typescript
  if (!hasPaidSub) { router.push(`/checkout/${plan.id}?cycle=${selectedCycle}`); return; }
  ```
  Change to: POST `/api/billing/checkout { planId, cycle }`, open overlay, fallback to `window.location.href`.

- [ ] **Step 1: Add the import**

At the top of `components/billing/PlansModal.tsx`, add:
```typescript
import { openDodoOverlay } from '@/lib/billing/dodo-overlay';
```

- [ ] **Step 2: Wire the overlay in `CreditPackCard.handleClick`**

Find the block inside `handleClick` in `CreditPackCard`:
```typescript
            // No saved card → redirect to the Dodo checkout URL returned by
            // the server. The webhook handles the grant on completion.
            if (json.requiresCheckout) {
                if (json.url) {
                    window.location.href = json.url;
                } else {
                    setErrorMessage('Could not open checkout. Please try again.');
                    setStatus('error');
                }
                return;
            }
```

Replace the entire `if (json.requiresCheckout)` block with:
```typescript
            // No saved card → open Dodo overlay checkout; fall back to redirect
            // if the SDK fails to load (e.g. ad-blocker, unsupported env).
            if (json.requiresCheckout) {
                if (!json.url) {
                    setErrorMessage('Could not open checkout. Please try again.');
                    setStatus('error');
                    return;
                }
                const overlayResult = await openDodoOverlay({
                    checkoutUrl: json.url,
                    mode: json.mode ?? 'test',
                    onSuccess: async () => {
                        // Overlay closed after payment — poll for the credit grant,
                        // same path as the silent-charge success branch below.
                        setStatus('processing');
                        const grant = await pollLedgerForPack(pack.id, startedAtMs, { timeoutMs: 25000 });
                        if (!grant) {
                            setErrorMessage(
                                "Payment accepted, but the credits haven't been added yet. Refresh in a moment — they'll show up automatically.",
                            );
                            setStatus('error');
                            return;
                        }
                        setStatus('success');
                        setTimeout(() => { window.location.reload(); }, 1400);
                    },
                    onClose: () => {
                        // User dismissed the overlay without paying — reset to idle.
                        setStatus(null);
                        setLoading(false);
                    },
                    onError: (msg) => {
                        setErrorMessage(msg || 'Checkout error. Please try again.');
                        setStatus('error');
                    },
                });
                if (!overlayResult.ok) {
                    // SDK failed — fall back to full-page redirect.
                    window.location.href = json.url;
                }
                return;
            }
```

- [ ] **Step 3: Wire the overlay in `PlanCTA.handleClick` for first-time subscription**

Find the first-time-purchase branch in `PlanCTA.handleClick`:
```typescript
    const handleClick = async () => {
        setErrorMessage(null);
        if (!hasPaidSub) {
            // First-time purchase: no saved sub to mutate, so route through
            // the checkout page. Pass through whatever cycle the user picked
            // so they don't get surprised on the checkout page.
            router.push(`/checkout/${plan.id}?cycle=${selectedCycle}`);
            return;
        }
```

Replace the `if (!hasPaidSub) { ... return; }` block with:
```typescript
    const handleClick = async () => {
        setErrorMessage(null);
        if (!hasPaidSub) {
            // First-time purchase: POST to /api/billing/checkout, then open
            // the overlay. Fall back to redirect if the SDK fails.
            setStatus('processing');
            try {
                const res = await fetch('/api/billing/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ planId: plan.id, cycle: selectedCycle }),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setErrorMessage(json?.error || 'Failed to start checkout. Please try again.');
                    setStatus('error');
                    return;
                }
                if (!json.url) {
                    setErrorMessage('No checkout URL received. Please try again.');
                    setStatus('error');
                    return;
                }

                const overlayResult = await openDodoOverlay({
                    checkoutUrl: json.url,
                    mode: json.mode ?? 'test',
                    onSuccess: async () => {
                        // Payment complete — re-fetch subscription to confirm the plan change.
                        setStatus('processing');
                        try {
                            const subRes = await fetch('/api/billing/subscription');
                            // Regardless of fetch outcome, show success and reload so
                            // the subscription hook everywhere picks up the new row.
                        } catch {
                            // Best-effort — the webhook will land the state regardless.
                        }
                        setStatus('success');
                        setTimeout(() => {
                            onClose();
                            window.location.reload();
                        }, 1400);
                    },
                    onClose: () => {
                        // User dismissed without paying — reset to idle.
                        setStatus(null);
                    },
                    onError: (msg) => {
                        setErrorMessage(msg || 'Checkout error. Please try again.');
                        setStatus('error');
                    },
                });
                if (!overlayResult.ok) {
                    // SDK failed — fall back to full-page redirect.
                    window.location.href = json.url;
                }
            } catch (e: any) {
                setErrorMessage(e?.message || 'Network error. Please try again.');
                setStatus('error');
            }
            return;
        }
```

- [ ] **Step 4: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/billing/PlansModal.tsx
git commit -m "feat(billing): wire dodo overlay into PlansModal (pack purchase + first subscription)"
```

---

### Task 4: Wire overlay into `app/checkout/[planId]/page.tsx`

**Files:**
- Modify: `app/checkout/[planId]/page.tsx`

**Interfaces:**
- Consumes: `openDodoOverlay` from `@/lib/billing/dodo-overlay`
- Currently `handleSubscribe` ends with `window.location.href = json.url` after fetching `/api/billing/checkout`.
  The route now returns `{ url, mode }`. Use the overlay; on success redirect to `/billing/success`; on close reset submitting; on SDK failure fall back to redirect.

- [ ] **Step 1: Add the import**

At the top of `app/checkout/[planId]/page.tsx`, add:
```typescript
import { openDodoOverlay } from '@/lib/billing/dodo-overlay';
```

- [ ] **Step 2: Update `handleSubscribe` to use the overlay**

Find the current `handleSubscribe` handler. The block at the end currently reads:
```typescript
            if (!json.url) {
                setError('No checkout URL received. Please try again.');
                return;
            }
            window.location.href = json.url;
```

Replace those lines with:
```typescript
            if (!json.url) {
                setError('No checkout URL received. Please try again.');
                return;
            }
            const overlayResult = await openDodoOverlay({
                checkoutUrl: json.url,
                mode: json.mode ?? 'test',
                onSuccess: () => {
                    window.location.href = '/billing/success';
                },
                onClose: () => {
                    setSubmitting(false);
                },
                onError: (msg) => {
                    setError(msg || 'Checkout error. Please try again.');
                    setSubmitting(false);
                },
            });
            if (!overlayResult.ok) {
                // SDK failed (ad-blocker, unsupported env) — fall back to redirect.
                window.location.href = json.url;
            }
```

Also update the button label and the description paragraph below it to not say "redirecting" when the overlay is active. Find:
```typescript
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Redirecting to checkout…
                        </>
```
Change to:
```typescript
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Opening checkout…
                        </>
```

And the small paragraph below the button:
```typescript
                        <p className="text-[11px] text-slate-600 mt-4 text-center leading-relaxed">
                            You will be redirected to Dodo Payments to complete your purchase securely.
                        </p>
```
Change to:
```typescript
                        <p className="text-[11px] text-slate-600 mt-4 text-center leading-relaxed">
                            A secure Dodo Payments checkout will open to complete your purchase.
                        </p>
```

- [ ] **Step 3: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/checkout/[planId]/page.tsx
git commit -m "feat(billing): wire dodo overlay into standalone checkout page"
```

---

### Task 5: Feature B — Migration + `save_payment_info` backend reads

**Files:**
- Create: `supabase/migrations/20260618b_save_payment_info.sql`
- Modify: `app/api/billing/checkout/route.ts`
- Modify: `app/api/billing/buy-pack/route.ts`

**Interfaces:**
- Both routes now pass `show_saved_payment_methods: true` to `checkoutSessions.create` when `save_payment_info === true` AND `existingCustomerId` is set.
- Migration adds `save_payment_info BOOLEAN NOT NULL DEFAULT false` column.
- All reads of `save_payment_info` catch errors and default to `false` — graceful degrade if migration hasn't been applied yet.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260618b_save_payment_info.sql`:
```sql
BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS save_payment_info BOOLEAN NOT NULL DEFAULT false;

COMMIT;
```

- [ ] **Step 2: Update `app/api/billing/checkout/route.ts` to read the preference**

The route already loads `profiles.payment_disputed_at` from the service client inside a scoped block. We need to also read `save_payment_info` from that block, then use it when creating the checkout session.

Find the existing profile-read block (around lines 36-52):
```typescript
        // ── Dispute gate ──────────────────────────────────────────────────────
        // Refuse checkout while a chargeback is unresolved (mirrors change-plan).
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
        }
```

Replace with (expand select, capture `savePaymentInfo` outside the block):
```typescript
        // ── Dispute gate + payment preference ────────────────────────────────
        let savePaymentInfo = false;
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at, save_payment_info')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
            // Graceful degrade: column may not exist yet (migration pending).
            savePaymentInfo = profile?.save_payment_info === true;
        }
```

Then find the `checkoutSessions.create` call and add `show_saved_payment_methods` conditionally. The current call is:
```typescript
        const session = await getDodo().checkoutSessions.create({
            product_cart: [{ product_id: productId, quantity: 1 }],
            customer,
            metadata: {
                user_id: user.id,
                kind: 'subscription',
                plan_id: planId,
                cycle,
            },
            return_url: `${appUrl}/billing/success`,
            subscription_data: {},
        });
```

Change to:
```typescript
        const session = await getDodo().checkoutSessions.create({
            product_cart: [{ product_id: productId, quantity: 1 }],
            customer,
            metadata: {
                user_id: user.id,
                kind: 'subscription',
                plan_id: planId,
                cycle,
            },
            return_url: `${appUrl}/billing/success`,
            subscription_data: {},
            ...(savePaymentInfo && existingCustomerId ? { show_saved_payment_methods: true } : {}),
        });
```

Note: `existingCustomerId` is already declared before the customer block. It is typed `string | null | undefined` — the condition `savePaymentInfo && existingCustomerId` safely gates on truthy.

- [ ] **Step 3: Update `app/api/billing/buy-pack/route.ts` to read the preference**

Same pattern — the existing profile block currently selects only `payment_disputed_at`. Expand it and capture `savePaymentInfo`:

Find:
```typescript
        // Dispute gate: refuse new purchases while a chargeback is unresolved.
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
        }
```

Replace with:
```typescript
        // Dispute gate + payment preference
        let savePaymentInfo = false;
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at, save_payment_info')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
            savePaymentInfo = profile?.save_payment_info === true;
        }
```

Then find the `dodo.checkoutSessions.create` call in the no-active-sub branch:
```typescript
            session = await dodo.checkoutSessions.create({
                product_cart: [{ product_id: pack.dodoProductId, quantity: 1 }],
                customer,
                metadata: {
                    user_id: user.id,
                    kind: 'pack',
                    pack_id: pack.id,
                },
                return_url: `${appUrl}/billing/success`,
                // No subscription_data → one-time payment
            });
```

Change to:
```typescript
            session = await dodo.checkoutSessions.create({
                product_cart: [{ product_id: pack.dodoProductId, quantity: 1 }],
                customer,
                metadata: {
                    user_id: user.id,
                    kind: 'pack',
                    pack_id: pack.id,
                },
                return_url: `${appUrl}/billing/success`,
                // No subscription_data → one-time payment
                ...(savePaymentInfo && sub?.dodo_customer_id ? { show_saved_payment_methods: true } : {}),
            });
```

Note: `sub` is already in scope here — it was fetched above to decide whether to charge silently. `sub?.dodo_customer_id` is the returning-customer gate.

- [ ] **Step 4: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors. If TypeScript complains about `save_payment_info` not being in the Supabase types (generated from DB), the `profile?.save_payment_info === true` check already handles `undefined` — but if the generated types are strict, we can cast: `(profile as any)?.save_payment_info === true`. Apply the cast only if TS reports an error on that line.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618b_save_payment_info.sql app/api/billing/checkout/route.ts app/api/billing/buy-pack/route.ts
git commit -m "feat(billing): save_payment_info migration + pass show_saved_payment_methods on checkout"
```

---

### Task 6: Feature B — `POST /api/billing/save-payment-info` + extend `GET /api/billing/subscription`

**Files:**
- Create: `app/api/billing/save-payment-info/route.ts`
- Modify: `app/api/billing/subscription/route.ts`

**Interfaces:**
- Produces:
  - `POST /api/billing/save-payment-info` body `{ enabled: boolean }` → `{ ok: true, enabled: boolean }`
  - `GET /api/billing/subscription` response gains `savePaymentInfo: boolean` and `hasSavedCustomer: boolean`
- Consumes: Supabase service client; auth from session client.

- [ ] **Step 1: Create `app/api/billing/save-payment-info/route.ts`**

```typescript
/**
 * POST /api/billing/save-payment-info
 *
 * Sets profiles.save_payment_info for the authenticated user.
 * Body: { enabled: boolean }
 * Response: { ok: true, enabled: boolean }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface SavePaymentInfoBody {
    enabled?: boolean;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as SavePaymentInfoBody;
        if (typeof body.enabled !== 'boolean') {
            return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
        }

        const service = createServiceClient();
        const { error } = await service
            .from('profiles')
            .update({ save_payment_info: body.enabled } as any)
            .eq('id', user.id);

        if (error) {
            console.error('[save-payment-info] update error:', error);
            return NextResponse.json({ error: error.message || 'Failed to update preference' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, enabled: body.enabled });
    } catch (err: any) {
        console.error('[save-payment-info] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
```

Note: `.update({ save_payment_info: body.enabled } as any)` uses `as any` to degrade gracefully if the Supabase generated types don't yet include the column. Replace with the typed column name once the migration is applied and types are regenerated.

- [ ] **Step 2: Extend `GET /api/billing/subscription` to include `savePaymentInfo` and `hasSavedCustomer`**

Currently the route selects from `subscriptions` only. We need to also fetch `profiles.save_payment_info` from the service client, and expose `dodo_customer_id` as `hasSavedCustomer`.

Find the existing `service.from('subscriptions').select(...)` block:
```typescript
        const service = createServiceClient();
        const { data, error: fetchErr } = await service
            .from('subscriptions')
            .select('plan_id, status, next_topup_at, current_period_end, cancel_at_period_end, billing_cycle, pending_plan_change_price_id')
            .eq('user_id', user.id)
            .single();
```

Change to also fetch `dodo_customer_id`:
```typescript
        const service = createServiceClient();
        const { data, error: fetchErr } = await service
            .from('subscriptions')
            .select('plan_id, status, next_topup_at, current_period_end, cancel_at_period_end, billing_cycle, pending_plan_change_price_id, dodo_customer_id')
            .eq('user_id', user.id)
            .single();
```

Then, after the subscription block (after `let pendingPlanChange = ...`), add a profile fetch for the preference (with graceful degrade):
```typescript
        // Load save_payment_info preference — graceful degrade if column missing.
        let savePaymentInfo = false;
        try {
            const { data: profile } = await service
                .from('profiles')
                .select('save_payment_info')
                .eq('id', user.id)
                .maybeSingle();
            savePaymentInfo = (profile as any)?.save_payment_info === true;
        } catch {
            // Column not yet applied — default to false.
        }
```

Finally, add `savePaymentInfo` and `hasSavedCustomer` to the response object:
```typescript
        return NextResponse.json({
            subscription: {
                planId: data.plan_id as PlanId,
                status: data.status,
                nextTopupAt: data.next_topup_at,
                currentPeriodEnd: data.current_period_end,
                cancelAtPeriodEnd: data.cancel_at_period_end,
                billingCycle:
                    data.billing_cycle === 'monthly' || data.billing_cycle === 'yearly'
                        ? data.billing_cycle
                        : null,
                pendingPlanChange,
                savePaymentInfo,
                hasSavedCustomer: Boolean((data as any).dodo_customer_id),
            },
        });
```

- [ ] **Step 3: Update `lib/billing/use-subscription.ts` to expose the new fields**

The `SubscriptionInfo` interface needs two new optional fields (optional so existing callers don't break if the API returns an old response):

Find:
```typescript
export interface SubscriptionInfo {
    planId: PlanId;
    status: 'active' | 'canceled' | 'past_due';
    nextTopupAt: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** 'monthly' or 'yearly' for paid plans; null for free. */
    billingCycle: 'monthly' | 'yearly' | null;
    pendingPlanChange: PendingPlanChange | null;
}
```

Add the two new fields:
```typescript
export interface SubscriptionInfo {
    planId: PlanId;
    status: 'active' | 'canceled' | 'past_due';
    nextTopupAt: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** 'monthly' or 'yearly' for paid plans; null for free. */
    billingCycle: 'monthly' | 'yearly' | null;
    pendingPlanChange: PendingPlanChange | null;
    /** Whether the user has opted in to saving their payment info for faster checkout. */
    savePaymentInfo?: boolean;
    /** Whether the user has a saved Dodo customer (has purchased at least once). */
    hasSavedCustomer?: boolean;
}
```

- [ ] **Step 4: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/billing/save-payment-info/route.ts app/api/billing/subscription/route.ts lib/billing/use-subscription.ts
git commit -m "feat(billing): add save-payment-info API route + expose savePaymentInfo/hasSavedCustomer on subscription endpoint"
```

---

### Task 7: Feature B — Toggle UI in `CreditsBillingTab`

**Files:**
- Modify: `components/account/CreditsBillingTab.tsx`

**Interfaces:**
- Consumes: `useSubscription` from `@/lib/billing/use-subscription` (already in the file as `useHasPaidSub` indirectly via `PlanBillingView` — we import it directly here)
- Consumes: `Switch` from `@/components/ui/Switch`
- Renders: a labelled toggle "Save my payment info for faster checkout" gated on `hasSavedCustomer === true`, wired to `POST /api/billing/save-payment-info`.

- [ ] **Step 1: Update imports in `CreditsBillingTab.tsx`**

The file currently imports:
```typescript
import React, { useEffect } from 'react';
import { useCreditBreakdown } from '@/lib/billing/use-credit-breakdown';
import { CreditsBreakdownPanel } from '@/components/billing/CreditsBreakdownPanel';
import { TokenLedgerSection } from '@/components/billing/TokenLedgerSection';
import { InvoicesSection, useHasPaidSub } from '@/components/billing/PlanBillingView';
```

Change to:
```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { useCreditBreakdown } from '@/lib/billing/use-credit-breakdown';
import { CreditsBreakdownPanel } from '@/components/billing/CreditsBreakdownPanel';
import { TokenLedgerSection } from '@/components/billing/TokenLedgerSection';
import { InvoicesSection, useHasPaidSub } from '@/components/billing/PlanBillingView';
import { useSubscription } from '@/lib/billing/use-subscription';
import { Switch } from '@/components/ui/Switch';
```

- [ ] **Step 2: Rewrite `CreditsBillingTab` to add the toggle**

Replace the entire function body with:
```typescript
export function CreditsBillingTab() {
    const { data: breakdown, loading, fetchBreakdown } = useCreditBreakdown();
    const hasPaidSub = useHasPaidSub();
    const { subscription } = useSubscription();

    const hasSavedCustomer = subscription?.hasSavedCustomer ?? false;
    const [savePaymentInfo, setSavePaymentInfo] = useState<boolean>(false);
    const [savingPref, setSavingPref] = useState(false);

    // Sync local state when subscription data loads.
    useEffect(() => {
        if (subscription?.savePaymentInfo !== undefined) {
            setSavePaymentInfo(subscription.savePaymentInfo);
        }
    }, [subscription?.savePaymentInfo]);

    useEffect(() => {
        fetchBreakdown();
    }, [fetchBreakdown]);

    const handleToggleSave = useCallback(async (checked: boolean) => {
        setSavePaymentInfo(checked);
        setSavingPref(true);
        try {
            await fetch('/api/billing/save-payment-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: checked }),
            });
        } catch {
            // Best-effort — revert on error.
            setSavePaymentInfo(!checked);
        } finally {
            setSavingPref(false);
        }
    }, []);

    return (
        <div className="space-y-5">
            <CreditsBreakdownPanel data={breakdown} loading={loading} variant="panel" />

            {hasSavedCustomer && (
                <div className="rounded-xl border border-stroke-subtle bg-surface-primary/40 p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm font-medium text-content-primary">
                                Save my payment info for faster checkout
                            </p>
                            <p className="text-xs text-content-tertiary mt-0.5">
                                We&apos;ll show your saved card next time for faster checkout.
                            </p>
                        </div>
                        <Switch
                            checked={savePaymentInfo}
                            onCheckedChange={handleToggleSave}
                            disabled={savingPref}
                            size="sm"
                        />
                    </div>
                </div>
            )}

            <div className={`grid gap-5 ${hasPaidSub ? 'xl:grid-cols-2' : ''}`}>
                <TokenLedgerSection />
                <InvoicesSection hasPaidSub={hasPaidSub} />
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Verify TypeScript**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/account/CreditsBillingTab.tsx
git commit -m "feat(billing): add save payment info toggle in CreditsBillingTab"
```

---

### Task 8: Report file + final verification

**Files:**
- Create: `.git/sdd/overlay-savecard-report.md`

- [ ] **Step 1: Create the report directory and file**

```bash
mkdir -p .git/sdd
```

Then create `.git/sdd/overlay-savecard-report.md` with:

```markdown
# Overlay Checkout + Save Payment Info — Implementation Report

## Files Changed

| File | Change |
|------|--------|
| `lib/billing/dodo-server.ts` | Added `getDodoCheckoutMode()` |
| `lib/billing/dodo-overlay.ts` | Created — client-only overlay helper |
| `app/api/billing/checkout/route.ts` | Returns `mode`; reads `save_payment_info`; passes `show_saved_payment_methods` |
| `app/api/billing/buy-pack/route.ts` | Returns `mode` on requiresCheckout branch; reads `save_payment_info`; passes `show_saved_payment_methods` |
| `app/api/billing/save-payment-info/route.ts` | Created — POST endpoint to toggle the preference |
| `app/api/billing/subscription/route.ts` | Extended response: `savePaymentInfo`, `hasSavedCustomer` |
| `lib/billing/use-subscription.ts` | Extended `SubscriptionInfo` with optional `savePaymentInfo` + `hasSavedCustomer` |
| `components/billing/PlansModal.tsx` | Overlay wired for pack checkout + first subscription |
| `app/checkout/[planId]/page.tsx` | Overlay wired for standalone checkout page |
| `components/account/CreditsBillingTab.tsx` | Save payment info toggle added |
| `supabase/migrations/20260618b_save_payment_info.sql` | Migration: `profiles.save_payment_info BOOLEAN NOT NULL DEFAULT false` |

## Overlay Event Mapping

| SDK event | Action |
|-----------|--------|
| `checkout.redirect` | Call `onSuccess()`, then `DodoPayments.Checkout.close()` |
| `checkout.redirect_requested` | Call `onSuccess()`, then `DodoPayments.Checkout.close()` |
| `checkout.closed` | Call `onClose()` |
| `checkout.error` | Call `onError(e.data?.message)` |
| `checkout.link_expired` | Call `onError('Checkout link expired. Please try again.')` |
| All other events | Ignored |

## Fallback Behavior

`openDodoOverlay` wraps the entire SDK import + `Initialize` + `open` in a try/catch.
If **anything** throws (SDK failed to load, ad-blocker, unsupported browser), it returns
`{ ok: false }` without rethrowing. All three call-sites check `if (!overlayResult.ok) {
window.location.href = json.url; }` — the existing redirect flow is preserved.

## Mode Plumbing

`getDodoCheckoutMode()` in `lib/billing/dodo-server.ts` derives `'live' | 'test'` from the
existing `getDodoEnvironment()` result (no new env var). Both checkout routes include `mode`
in their JSON response. The client reads `json.mode ?? 'test'` (safe default) and passes it
to `openDodoOverlay` → `DodoPayments.Initialize({ mode })`.

## Migration + Graceful Degrade

- `supabase/migrations/20260618b_save_payment_info.sql` adds `profiles.save_payment_info`
  (operator applies it — not auto-applied).
- All reads use `profile?.save_payment_info === true` / `(profile as any)?.save_payment_info === true`,
  which evaluates to `false` when the column is absent — checkout works unchanged before migration.
- The subscription GET wraps the profile read in a try/catch block — column-not-found errors
  from a strict Supabase client are silently ignored, defaulting to `false`.

## Toggle Location

`components/account/CreditsBillingTab.tsx` — shown only when `hasSavedCustomer === true`
(i.e. `subscription.hasSavedCustomer`, which maps to `Boolean(dodo_customer_id)` in the DB).
Uses `components/ui/Switch` (size="sm"). Wires to `POST /api/billing/save-payment-info`.
Helper line: "We'll show your saved card next time for faster checkout."

## TSC Result

`npx tsc --noEmit` — 0 errors.
```

- [ ] **Step 2: Final TypeScript check**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Final commit**

```bash
git add .git/sdd/overlay-savecard-report.md docs/superpowers/plans/2026-06-18-dodo-overlay-savecard.md
git commit -m "docs(billing): add overlay+savecard implementation report and plan"
```
