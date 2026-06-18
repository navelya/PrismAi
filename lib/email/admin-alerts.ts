/**
 * Admin alerts for billing exception cases.
 *
 * Used by the Dodo webhook to notify admin of chargebacks, partial refunds,
 * and clawback shortfalls. All errors caught internally — email send failure
 * must never break the webhook flow.
 */
import { Resend } from 'resend';

export type AdminAlertKind =
    | 'chargeback'
    | 'partial_refund'
    | 'clawback_shortfall'
    | 'chargeback_reverse'
    | 'unknown_user';

interface SendAdminAlertArgs {
    kind: AdminAlertKind;
    summary: string;
    details: Record<string, unknown>;
}

export async function sendAdminAlert(args: SendAdminAlertArgs): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.ADMIN_ALERT_EMAIL;
    const from = process.env.ADMIN_ALERT_FROM || 'alerts@prismai.local';

    if (!apiKey || !to) {
        console.error('[Admin Alert] RESEND_API_KEY or ADMIN_ALERT_EMAIL not configured — alert suppressed.', {
            kind: args.kind,
            summary: args.summary,
        });
        return;
    }

    const subject = `[PrismAi Billing] ${args.kind}: ${args.summary}`;
    const body = [
        `Kind: ${args.kind}`,
        `Summary: ${args.summary}`,
        '',
        'Details:',
        JSON.stringify(args.details, null, 2),
        '',
        `Sent: ${new Date().toISOString()}`,
    ].join('\n');

    try {
        const resend = new Resend(apiKey);
        await resend.emails.send({
            from,
            to,
            subject,
            text: body,
        });
    } catch (err: any) {
        console.error('[Admin Alert] Resend send failed:', err?.message ?? err, {
            kind: args.kind,
            summary: args.summary,
        });
    }
}
