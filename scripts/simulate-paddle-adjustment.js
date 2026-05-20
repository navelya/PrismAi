/**
 * Manual smoke test for the Paddle adjustment.created webhook handler.
 *
 * Usage:
 *   ADJUSTMENT_KIND=refund TX_ID=txn_xxx node scripts/simulate-paddle-adjustment.js
 *   ADJUSTMENT_KIND=chargeback TX_ID=txn_xxx node scripts/simulate-paddle-adjustment.js
 *   ADJUSTMENT_KIND=chargeback_reverse TX_ID=txn_xxx node scripts/simulate-paddle-adjustment.js
 *
 * Prerequisites:
 *   - Dev server running on http://localhost:3000
 *   - The 20260520_refund_chargeback_handling.sql migration has been applied
 *   - TX_ID corresponds to a real transaction recorded in token_ledger (i.e.
 *     a paddle_pack_purchase or paddle_subscription_grant whose metadata
 *     contains paddle_transaction_id = TX_ID).
 *     Find one with:
 *       SELECT metadata->>'paddle_transaction_id', amount, user_id
 *       FROM token_ledger
 *       WHERE reason IN ('paddle_pack_purchase','paddle_subscription_grant')
 *       ORDER BY created_at DESC LIMIT 5;
 *
 * Note: The Paddle SDK's `webhooks.unmarshal` performs an HMAC check. This
 * script does NOT sign the payload — the webhook will reject it with 401
 * unless you TEMPORARILY comment out the signature verification block at
 * the top of POST() in app/api/webhooks/paddle/route.ts for local testing.
 * Restore the verification before committing.
 *
 * End-to-end signature verification is best covered by issuing a real refund
 * in Paddle Sandbox against a real test transaction.
 */
const KIND = process.env.ADJUSTMENT_KIND || 'refund';
const TX_ID = process.env.TX_ID;
const URL_TARGET = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/paddle';
const ORIG_TOTAL_CENTS = process.env.ORIG_TOTAL_CENTS || '1000';

if (!TX_ID) {
    console.error('Usage: TX_ID=txn_xxx ADJUSTMENT_KIND=refund node scripts/simulate-paddle-adjustment.js');
    console.error('  Optional: ORIG_TOTAL_CENTS=<int>  (match original transaction total in minor units; default 1000)');
    process.exit(1);
}

const adjustmentId = `adj_test_${Date.now()}`;
const eventId = `evt_test_${Date.now()}`;

const payload = {
    eventId,
    eventType: 'adjustment.created',
    occurredAt: new Date().toISOString(),
    data: {
        id: adjustmentId,
        action: KIND,
        status: 'approved',
        transactionId: TX_ID,
        reason: `local smoke test (${KIND})`,
        totals: {
            total: ORIG_TOTAL_CENTS,
        },
        originalTotals: {
            total: ORIG_TOTAL_CENTS,
        },
    },
};

(async () => {
    const body = JSON.stringify(payload);
    console.log(`Posting ${KIND} adjustment for tx ${TX_ID} to ${URL_TARGET}`);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const res = await fetch(URL_TARGET, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'paddle-signature': 'ts=0;h1=local-smoke-test',
        },
        body,
    });

    console.log(`Response: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log(text);
})();
