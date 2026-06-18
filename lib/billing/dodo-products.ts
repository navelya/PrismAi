/**
 * Dodo Payments product/price builders and sync helpers.
 *
 * These functions ONLY build price inputs and call the SDK; they do NOT touch
 * the database. Callers are responsible for persisting the returned product ids.
 */
import type { Price } from 'dodopayments/resources/products/products';
import { getDodo } from './dodo-server';

// ---------------------------------------------------------------------------
// Price builders
// ---------------------------------------------------------------------------

/**
 * Builds a recurring-price object for plans.
 *
 * Required fields per the SDK's RecurringPrice interface:
 *   currency, discount, payment_frequency_count, payment_frequency_interval,
 *   price, purchasing_power_parity, subscription_period_count,
 *   subscription_period_interval, type
 */
export function buildRecurringPrice(
  cents: number,
  interval: 'Month' | 'Year',
): Price.RecurringPrice {
  return {
    type: 'recurring_price',
    price: cents,
    currency: 'USD',
    discount: 0,
    purchasing_power_parity: false,
    payment_frequency_count: 1,
    payment_frequency_interval: interval,
    subscription_period_count: 1,
    subscription_period_interval: interval,
  };
}

/**
 * Builds a one-time price object for credit packs.
 *
 * Required fields per the SDK's OneTimePrice interface:
 *   currency, discount, price, purchasing_power_parity, type
 */
export function buildOneTimePrice(cents: number): Price.OneTimePrice {
  return {
    type: 'one_time_price',
    price: cents,
    currency: 'USD',
    discount: 0,
    purchasing_power_parity: false,
  };
}

// ---------------------------------------------------------------------------
// Plan sync (recurring — monthly + optional yearly)
// ---------------------------------------------------------------------------

interface PlanInput {
  id: string;
  display_name: string;
  tagline: string | null;
  price_cents: number;
  price_yearly_cents: number | null;
  dodo_product_id_monthly: string | null;
  dodo_product_id_yearly: string | null;
}

/**
 * Creates or updates Dodo product rows for a plan.
 * Monthly product is always created/updated.
 * Yearly product is only synced when price_yearly_cents is non-null.
 * Returns the resolved product ids.
 */
export async function syncPlanProducts(
  plan: PlanInput,
): Promise<{ monthly: string; yearly: string | null }> {
  const dodo = getDodo();
  const description = plan.tagline ?? undefined;

  // --- monthly ---
  let monthlyId: string;
  if (plan.dodo_product_id_monthly) {
    await dodo.products.update(plan.dodo_product_id_monthly, {
      price: buildRecurringPrice(plan.price_cents, 'Month'),
    });
    monthlyId = plan.dodo_product_id_monthly;
  } else {
    const created = await dodo.products.create({
      name: `${plan.display_name} (Monthly)`,
      description,
      tax_category: 'saas',
      price: buildRecurringPrice(plan.price_cents, 'Month'),
    });
    monthlyId = created.product_id;
  }

  // --- yearly (only when a yearly price is configured) ---
  let yearlyId: string | null = null;
  if (plan.price_yearly_cents != null) {
    if (plan.dodo_product_id_yearly) {
      await dodo.products.update(plan.dodo_product_id_yearly, {
        price: buildRecurringPrice(plan.price_yearly_cents, 'Year'),
      });
      yearlyId = plan.dodo_product_id_yearly;
    } else {
      const created = await dodo.products.create({
        name: `${plan.display_name} (Yearly)`,
        description,
        tax_category: 'saas',
        price: buildRecurringPrice(plan.price_yearly_cents, 'Year'),
      });
      yearlyId = created.product_id;
    }
  }

  return { monthly: monthlyId, yearly: yearlyId };
}

// ---------------------------------------------------------------------------
// Credit pack sync (one-time)
// ---------------------------------------------------------------------------

interface PackInput {
  id: string;
  display_name: string;
  tagline: string | null;
  price_cents: number;
  dodo_product_id: string | null;
}

/**
 * Creates or updates a Dodo product row for a credit pack.
 * Returns the resolved product id.
 */
export async function syncPackProduct(
  pack: PackInput,
): Promise<{ product_id: string }> {
  const dodo = getDodo();
  const description = pack.tagline ?? undefined;

  if (pack.dodo_product_id) {
    await dodo.products.update(pack.dodo_product_id, {
      price: buildOneTimePrice(pack.price_cents),
    });
    return { product_id: pack.dodo_product_id };
  }

  const created = await dodo.products.create({
    name: pack.display_name,
    description,
    tax_category: 'digital_products',
    price: buildOneTimePrice(pack.price_cents),
  });
  return { product_id: created.product_id };
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Archives a Dodo product by id. Idempotent — archiving an already-archived
 * product is a no-op on the Dodo side.
 */
export async function archiveProduct(productId: string): Promise<void> {
  await getDodo().products.archive(productId);
}
