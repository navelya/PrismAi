/**
 * Paddle price mutations for the admin pricing panel.
 *
 * Paddle prices are immutable in amount, so changing a price means creating a
 * NEW price under the same product and archiving the old one. Existing
 * subscriptions keep referencing the old (archived) price — that's the
 * grandfathering guarantee.
 */
import { type CreatePriceRequestBody } from '@paddle/paddle-node-sdk';
import { getPaddle } from './paddle-server';

export interface CreatePriceArgs {
    productId: string;
    /** Whole-dollar amount from the admin UI. Converted to minor units here. */
    amountDollars: number;
    /** 'month' | 'year' for subscriptions; omit for one-time packs. */
    interval?: 'month' | 'year';
    description: string;
}

/** Derive (and let the caller cache) the parent product id from an existing price. */
export async function getProductIdForPrice(priceId: string): Promise<string> {
    const paddle = getPaddle();
    const price = await paddle.prices.get(priceId);
    const productId = price.productId;
    if (!productId) throw new Error(`Could not resolve product id for price ${priceId}`);
    return productId;
}

/** Create a new Paddle price and return its id. */
export async function createPaddlePrice(args: CreatePriceArgs): Promise<string> {
    const paddle = getPaddle();
    const amount = String(Math.round(args.amountDollars * 100)); // minor units, USD
    const payload: CreatePriceRequestBody = {
        description: args.description,
        productId: args.productId,
        unitPrice: { amount, currencyCode: 'USD' },
        ...(args.interval ? { billingCycle: { interval: args.interval, frequency: 1 } } : {}),
    };
    const created = await paddle.prices.create(payload);
    const id = created.id;
    if (!id) throw new Error('Paddle price creation returned no id');
    return id;
}

/** Archive an old price so it can't be used for new checkouts (existing subs unaffected). */
export async function archivePaddlePrice(priceId: string): Promise<void> {
    const paddle = getPaddle();
    await paddle.prices.archive(priceId);
}
