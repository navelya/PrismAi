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
