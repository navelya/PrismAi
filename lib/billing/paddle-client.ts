'use client';

/**
 * Client-side Paddle.js initializer.
 *
 * Loads Paddle.js once per page lifecycle, configured for the environment
 * specified by NEXT_PUBLIC_PADDLE_ENVIRONMENT (sandbox by default). Returns
 * the same Paddle instance on subsequent calls so downstream callers can
 * `await` and treat it like a singleton.
 */
import { initializePaddle, type Paddle } from '@paddle/paddle-js';

let paddlePromise: Promise<Paddle | undefined> | null = null;

export function loadPaddle(): Promise<Paddle | undefined> {
    if (paddlePromise) return paddlePromise;

    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
        console.error('[Paddle] NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is missing — checkout is disabled.');
        paddlePromise = Promise.resolve(undefined);
        return paddlePromise;
    }

    const env = (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT || 'sandbox').toLowerCase();

    paddlePromise = initializePaddle({
        environment: env === 'production' ? 'production' : 'sandbox',
        token,
    });

    return paddlePromise;
}

/**
 * Open the Paddle overlay checkout for a single price ID.
 * Pass `userId` and `userEmail` so the webhook can correlate payment back
 * to a Supabase user without a separate customer-creation round-trip.
 */
export interface OpenCheckoutArgs {
    priceId: string;
    userId: string;
    userEmail: string;
    successUrl?: string;
}

export async function openPaddleCheckout({ priceId, userId, userEmail, successUrl }: OpenCheckoutArgs): Promise<void> {
    const paddle = await loadPaddle();
    if (!paddle) {
        throw new Error('Paddle.js failed to initialize. Check the client token and approved domains.');
    }

    paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email: userEmail },
        customData: {
            user_id: userId,
        },
        settings: {
            displayMode: 'overlay',
            theme: 'dark',
            successUrl: successUrl || `${window.location.origin}/billing/success`,
        },
    });
}
