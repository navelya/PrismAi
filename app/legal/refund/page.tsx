import { LegalHeader, Section, P, UL, Strong } from '@/components/legal/LegalProse';

export const metadata = {
    title: 'Refund & Cancellation Policy — Prisfol',
    description: 'How to cancel your Prisfol subscription and when refunds apply.',
};

export default function RefundPage() {
    return (
        <article>
            <LegalHeader tag="Legal" title="Refund & Cancellation Policy" updated="May 5, 2026" />

            <Section title="1. How to cancel">
                <P>
                    You can cancel a paid Prisfol subscription at any time, in two ways:
                </P>
                <UL>
                    <li>From your account: open <Strong>Settings → Plan &amp; Billing</Strong> and choose <Strong>Cancel subscription</Strong>. Cancellation is processed via the Stripe customer portal.</li>
                    <li>By email: write to <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a> from the address on your account and we will process the cancellation within two business days.</li>
                </UL>
                <P>
                    When you cancel, your subscription remains active until the end of the billing period you have already
                    paid for. After that date, your account is automatically moved to the free tier — your saved workflows
                    and assets stay in place, subject to free-tier limits.
                </P>
            </Section>

            <Section title="2. Refund eligibility">
                <P>
                    Because the Service consumes paid third-party AI inference on your behalf as soon as you use it, we do
                    not offer refunds by default for past billing periods. However, you may be entitled to a refund in the
                    following situations:
                </P>
                <UL>
                    <li><Strong>14-day right of withdrawal (EU / UK / Israel consumers).</Strong> If you are a consumer based in a jurisdiction that grants a statutory cooling-off period, you may withdraw from your first paid subscription within 14 days of purchase for a full refund — provided you have not consumed a substantial portion of the credits included in that billing period. By starting to consume credits within the cooling-off period you expressly acknowledge that any refund may be reduced proportionally to the credits used.</li>
                    <li><Strong>Duplicate or accidental charges.</Strong> If you were charged twice for the same period or charged after a confirmed cancellation, we will issue a full refund of the affected charge.</li>
                    <li><Strong>Material service failure.</Strong> If the Service is unavailable for an extended, sustained period that materially prevents you from using a paid plan, we will at our discretion issue credits or a pro-rated refund covering the affected period.</li>
                </UL>
                <P>
                    Outside of the situations above, all charges are final. Partial-month refunds are not provided when you
                    cancel mid-cycle.
                </P>
            </Section>

            <Section title="3. Credits">
                <P>
                    Credits — including monthly plan credits, signup bonus credits and any additional purchased credits —
                    are <Strong>non-refundable and non-transferable</Strong> once issued. Unused credits expire according
                    to the rules disclosed at the time you receive or purchase them (for example, monthly plan credits do
                    not roll over once a new billing cycle begins, unless a specific plan states otherwise).
                </P>
                <P>
                    If your account is terminated for breach of our Terms of Service, any remaining credits are forfeited
                    and no refund is due.
                </P>
            </Section>

            <Section title="4. Failed or rejected charges">
                <P>
                    If a renewal charge fails, we may retry the charge over several days as permitted by Stripe&apos;s
                    standard dunning. If we are unable to collect payment, your account will revert to the free tier
                    until payment is restored.
                </P>
            </Section>

            <Section title="5. How to request a refund">
                <P>
                    To request a refund under any of the situations above, email{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>{' '}
                    from the address on your account, including your invoice number and a short explanation. We respond
                    within five business days. Approved refunds are returned to the original payment method via Stripe and
                    typically appear within 5–10 business days, depending on your bank.
                </P>
            </Section>

            <Section title="6. Chargebacks">
                <P>
                    If you believe a charge is incorrect, please contact us first — we can almost always resolve the issue
                    faster than the chargeback process. Filing a chargeback for a valid charge may result in immediate
                    suspension of your account pending investigation.
                </P>
            </Section>

            <Section title="7. Changes to this policy">
                <P>
                    We may update this Refund &amp; Cancellation Policy from time to time. Changes apply to billing cycles
                    that begin after the effective date and never reduce statutory rights you already have under
                    applicable consumer-protection law.
                </P>
            </Section>
        </article>
    );
}
