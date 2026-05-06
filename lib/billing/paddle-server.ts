/**
 * Server-side Paddle SDK client.
 *
 * Lazy-initialized on first use so a missing key during build doesn't crash
 * the build, only runtime calls. Reads PADDLE_API_KEY and PADDLE_ENVIRONMENT
 * (sandbox | production). Sandbox is the default during development.
 */
import { Environment, Paddle, type PaddleOptions } from '@paddle/paddle-node-sdk';

let cached: Paddle | null = null;

export function getPaddle(): Paddle {
    if (cached) return cached;

    const apiKey = process.env.PADDLE_API_KEY;
    if (!apiKey) {
        throw new Error('PADDLE_API_KEY is not set. Add it to .env.local.');
    }

    const env = (process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase();
    const options: PaddleOptions = {
        environment: env === 'production' ? Environment.production : Environment.sandbox,
    };

    cached = new Paddle(apiKey, options);
    return cached;
}

export function getPaddleEnvironment(): 'sandbox' | 'production' {
    return (process.env.PADDLE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
        ? 'production'
        : 'sandbox';
}
