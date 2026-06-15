// lib/domains.ts
/**
 * Subdomain split: prisfol.com (marketing) vs app.prisfol.com (app).
 * Single source of truth for host classification, route lists, and absolute
 * URL builders.
 *
 * Safe on localhost / Vercel previews: when the prod hosts are not configured
 * (or don't match the request host) everything is classified 'neutral' and no
 * redirect/rewrite is applied — the app behaves exactly like today. All values
 * derive from NEXT_PUBLIC_* envs, which Next inlines at build for server,
 * client, AND edge (middleware) bundles.
 */

export type HostClass = 'app' | 'marketing' | 'neutral';

function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const APP_HOST = hostnameOf(process.env.NEXT_PUBLIC_APP_URL);
const MARKETING_HOST = hostnameOf(process.env.NEXT_PUBLIC_MARKETING_URL);

// The split is only meaningful when two DISTINCT hosts are configured. On
// localhost / previews (envs unset, or both pointing at the same host) it is
// disabled and everything is 'neutral' / relative — the app behaves like today.
const SPLIT_ENABLED = !!APP_HOST && !!MARKETING_HOST && APP_HOST !== MARKETING_HOST;

// App-only route prefixes (canonical home = app host). '/share' is the
// collaboration-invite accept page (gates on login, routes into the canvas).
const APP_ROUTE_PREFIXES = [
  '/chat', '/editor', '/templates', '/settings', '/admin',
  '/assets', '/library', '/nodes', '/login', '/auth', '/checkout',
  '/billing', '/share',
];

// Marketing-only route prefixes (canonical home = marketing host). '/' is
// handled by exact match in isMarketingRoute so it doesn't swallow every path.
const MARKETING_ROUTE_PREFIXES = ['/legal', '/pricing', '/demo', '/blog', '/roadmap'];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function classifyHost(host: string | null | undefined): HostClass {
  if (!SPLIT_ENABLED) return 'neutral';
  if (!host) return 'neutral';
  const h = host.split(':')[0].toLowerCase(); // strip :port
  if (APP_HOST && h === APP_HOST) return 'app';
  if (MARKETING_HOST && (h === MARKETING_HOST || h === `www.${MARKETING_HOST}`)) return 'marketing';
  return 'neutral';
}

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

export function isMarketingRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  return MARKETING_ROUTE_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

// Absolute URL builders. In prod (split active) return fully-qualified URLs so
// a <Link>/navigation crosses to the right subdomain. On neutral/dev (split
// disabled) return the path unchanged so client-side nav stays same-origin.
export function appUrl(path: string): string {
  if (!SPLIT_ENABLED) return path;
  const base = process.env.NEXT_PUBLIC_APP_URL!;
  const safePath = '/' + path.replace(/^\/+/, '');
  return `${base.replace(/\/$/, '')}${safePath}`;
}

export function marketingUrl(path: string): string {
  if (!SPLIT_ENABLED) return path;
  const base = process.env.NEXT_PUBLIC_MARKETING_URL!;
  const safePath = '/' + path.replace(/^\/+/, '');
  return `${base.replace(/\/$/, '')}${safePath}`;
}

// Auth cookie domain. undefined on dev/preview → cookies stay host-scoped.
export const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;

/**
 * Is this URL a local-dev address that an external provider's webhook can NEVER
 * reach? True for localhost, any *.localhost subdomain (e.g. app.localhost — the
 * subdomain-split dev host), 127.0.0.1, and ::1. An empty/unparseable URL counts
 * as local (nothing configured → assume dev).
 *
 * Used by the generation executors to decide between the synchronous local path
 * (poll inline / replicate.run) and the production webhook path. A naive
 * `startsWith('http://localhost')` check misses `app.localhost`, which silently
 * routes local runs through an unreachable webhook and hangs them forever.
 */
export function isLocalUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const h = hostnameOf(url);
  if (!h) return true;
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
}
