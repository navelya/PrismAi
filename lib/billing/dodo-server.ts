/**
 * Server-side Dodo Payments SDK client.
 *
 * Lazy-initialized on first use so a missing key during build doesn't crash
 * the build, only runtime calls. Reads DODO_API_KEY and DODO_ENVIRONMENT
 * (live | live_mode | production → live_mode, else test_mode).
 */
import DodoPayments from 'dodopayments';

let cached: DodoPayments | null = null;

export function getDodoEnvironment(): 'test_mode' | 'live_mode' {
  const e = (process.env.DODO_ENVIRONMENT || 'sandbox').toLowerCase();
  return e === 'live' || e === 'live_mode' || e === 'production' ? 'live_mode' : 'test_mode';
}

export function getDodo(): DodoPayments {
  if (cached) return cached;
  const bearerToken = process.env.DODO_API_KEY;
  if (!bearerToken) throw new Error('DODO_API_KEY is not set');
  cached = new DodoPayments({ bearerToken, environment: getDodoEnvironment() });
  return cached;
}
