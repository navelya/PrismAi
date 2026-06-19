'use client';

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

// Monotonically increasing token — incremented on each openDodoOverlay call.
// Any stale onEvent handler from a previous call will see myToken !== activeToken
// and bail out immediately, preventing double-fire across re-opens.
let activeToken = 0;

export async function openDodoOverlay(opts: DodoOverlayOptions): Promise<{ ok: boolean }> {
    const myToken = ++activeToken;
    let settled = false;

    try {
        const { DodoPayments } = await import('dodopayments-checkout');

        DodoPayments.Initialize({
            mode: opts.mode,
            displayType: 'overlay',
            onEvent: (e) => {
                // Guard: ignore events from any previous overlay invocation.
                if (myToken !== activeToken) return;

                switch (e.event_type) {
                    case 'checkout.redirect':
                    case 'checkout.redirect_requested':
                        if (settled) return;
                        settled = true;
                        opts.onSuccess?.();
                        DodoPayments.Checkout.close();
                        break;
                    // Belt-and-suspenders: if Dodo signals a succeeded payment via
                    // a status event (rather than a redirect), treat it as success
                    // too so the overlay always closes on a completed payment.
                    case 'checkout.status': {
                        const status = (e.data?.status as string | undefined) ?? '';
                        if (status === 'succeeded' || status === 'active' || status === 'paid') {
                            if (settled) return;
                            settled = true;
                            opts.onSuccess?.();
                            DodoPayments.Checkout.close();
                        }
                        break;
                    }
                    case 'checkout.closed':
                        if (settled) return;
                        settled = true;
                        opts.onClose?.();
                        break;
                    case 'checkout.error':
                    case 'checkout.link_expired': {
                        if (settled) return;
                        settled = true;
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
