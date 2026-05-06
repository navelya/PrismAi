import { LegalHeader, Section, P, UL, Strong } from '@/components/legal/LegalProse';

export const metadata = {
    title: 'Terms of Service — Prisfol',
    description: 'The terms governing your use of Prisfol.',
};

export default function TermsPage() {
    return (
        <article>
            <LegalHeader tag="Legal" title="Terms of Service" updated="May 5, 2026" />

            <Section title="1. Agreement">
                <P>
                    These Terms of Service (&quot;<Strong>Terms</Strong>&quot;) form a binding agreement between you
                    (&quot;<Strong>you</Strong>&quot;, &quot;<Strong>your</Strong>&quot;) and Prisfol
                    (&quot;<Strong>Prisfol</Strong>&quot;, &quot;<Strong>we</Strong>&quot;, &quot;<Strong>us</Strong>&quot;)
                    governing your access to and use of the Prisfol platform, website, APIs and related services
                    (collectively, the &quot;<Strong>Service</Strong>&quot;). By creating an account or using the Service
                    you confirm that you have read, understood and agree to be bound by these Terms and our{' '}
                    <a href="/legal/privacy" className="text-accent-primary hover:underline">Privacy Policy</a>.
                </P>
                <P>
                    If you are using the Service on behalf of an organization, you represent that you have authority to bind
                    that organization to these Terms.
                </P>
            </Section>

            <Section title="2. The Service">
                <P>
                    Prisfol is a chat-first automation platform that lets users build visual workflows that orchestrate
                    third-party AI models to generate, edit and process images and other graphic-design assets. Outputs are
                    produced by external AI providers and are inherently probabilistic: identical inputs may produce
                    different results, and outputs may contain inaccuracies.
                </P>
            </Section>

            <Section title="3. Eligibility & Accounts">
                <UL>
                    <li>You must be at least 16 years old (or the age of digital consent in your jurisdiction) to use the Service.</li>
                    <li>You are responsible for the accuracy of the information you provide and for keeping your credentials secure.</li>
                    <li>You are responsible for all activity that occurs under your account.</li>
                    <li>You must promptly notify us at <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a> of any unauthorized use.</li>
                </UL>
            </Section>

            <Section title="4. Plans, Credits & Billing">
                <P>
                    The Service is offered on free and paid plans. Paid plans are billed in advance on a recurring basis
                    (monthly or annual, as selected at checkout). One-time credit packs may also be purchased and consumed
                    alongside subscription credits. Payment processing is handled by{' '}
                    <Strong>Paddle.com Market Limited</Strong> (&ldquo;<Strong>Paddle</Strong>&rdquo;), which acts as the
                    Merchant of Record for your purchase. Paddle is responsible for collecting and remitting any applicable
                    sales tax, VAT or GST based on your billing location. By purchasing a plan or credit pack you also agree
                    to Paddle&apos;s applicable Buyer Terms.
                </P>
                <UL>
                    <li><Strong>Credits.</Strong> Generative actions consume credits. Free credits, plan credits and purchased credits may have different expiration and rollover rules disclosed at the point of purchase.</li>
                    <li><Strong>Renewals.</Strong> Subscriptions renew automatically until cancelled.</li>
                    <li><Strong>Price changes.</Strong> We may change pricing with at least 30 days&apos; notice; changes take effect at your next renewal.</li>
                    <li><Strong>Taxes.</Strong> Prices exclude applicable taxes, which will be added where required.</li>
                </UL>
                <P>
                    Cancellation and refund details are described in our{' '}
                    <a href="/legal/refund" className="text-accent-primary hover:underline">Refund &amp; Cancellation Policy</a>.
                </P>
            </Section>

            <Section title="5. Your Content & Intellectual Property">
                <P>
                    &quot;<Strong>Your Content</Strong>&quot; means all inputs you submit to the Service (prompts, uploaded
                    images, brand assets, configurations) and the outputs the Service generates from those inputs
                    (&quot;<Strong>Outputs</Strong>&quot;).
                </P>
                <UL>
                    <li><Strong>Inputs.</Strong> You retain all rights to inputs you submit. You grant Prisfol a worldwide, non-exclusive, royalty-free license to host, process, transmit and modify those inputs solely as needed to operate the Service for you.</li>
                    <li><Strong>Outputs.</Strong> As between you and Prisfol, you own the Outputs you generate, to the maximum extent permitted by applicable law and by the terms of the underlying AI providers. You are responsible for verifying that you have the rights necessary to use the Outputs for your intended purpose.</li>
                    <li><Strong>AI provider terms.</Strong> Outputs are produced through third-party model providers (such as Replicate-hosted models, Google&apos;s Gemini and others). Their terms may impose additional restrictions (for example on commercial use of certain models). You are responsible for complying with those terms.</li>
                    <li><Strong>No exclusivity.</Strong> Generative AI outputs are not unique. Other users may receive substantially similar Outputs from similar inputs.</li>
                    <li><Strong>Improving the Service.</Strong> We may use aggregated, de-identified data derived from usage to operate, maintain and improve the Service. We do not use your inputs or Outputs to train foundation models.</li>
                </UL>
            </Section>

            <Section title="6. Acceptable Use">
                <P>You agree that you will not, and will not permit any third party to:</P>
                <UL>
                    <li>Use the Service to generate content that is illegal, defamatory, harassing, hateful, sexually explicit involving minors, or that depicts non-consensual sexual content.</li>
                    <li>Generate content that infringes the intellectual property, privacy, publicity or other rights of any person.</li>
                    <li>Attempt to impersonate a real person, mislead about authorship, or generate deceptive deepfakes used for fraud.</li>
                    <li>Create malware, phishing material, or content intended to compromise security.</li>
                    <li>Reverse engineer, decompile, scrape at scale, or otherwise circumvent technical limits of the Service.</li>
                    <li>Resell, sublicense or expose the Service as a competing API without our written permission.</li>
                    <li>Use the Service in violation of any applicable export-control or sanctions law.</li>
                </UL>
                <P>
                    We may suspend or terminate accounts that breach this section, with or without notice, and may
                    remove offending content.
                </P>
            </Section>

            <Section title="7. Third-Party Services">
                <P>
                    The Service relies on third-party providers — including Supabase (database and auth), Paddle (payments and tax),
                    Vercel (hosting and analytics), Replicate (model hosting) and Google (Gemini API). Their performance is
                    outside our control and is governed by their own terms. We are not responsible for failures or losses
                    caused by these providers, except as required by law.
                </P>
            </Section>

            <Section title="8. Service Availability">
                <P>
                    We work to keep the Service available but do not guarantee uninterrupted operation. We may perform
                    maintenance, modify features, or limit usage. We may also impose rate limits and other technical
                    safeguards to protect platform stability. Free plans are provided on an &quot;as available&quot; basis
                    and may be modified or discontinued at any time.
                </P>
            </Section>

            <Section title="9. Disclaimer of Warranties">
                <P>
                    THE SERVICE AND ALL OUTPUTS ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;, WITHOUT
                    WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY OR OTHERWISE. PRISFOL EXPRESSLY DISCLAIMS
                    ALL WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND THAT THE
                    SERVICE WILL BE ERROR-FREE, SECURE OR UNINTERRUPTED. WE DO NOT WARRANT THE ACCURACY, COMPLETENESS OR
                    USEFULNESS OF ANY OUTPUT.
                </P>
            </Section>

            <Section title="10. Limitation of Liability">
                <P>
                    TO THE MAXIMUM EXTENT PERMITTED BY LAW, PRISFOL AND ITS SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT,
                    INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA OR
                    GOODWILL, ARISING OUT OF OR RELATED TO THESE TERMS OR THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF
                    SUCH DAMAGES.
                </P>
                <P>
                    OUR AGGREGATE LIABILITY FOR ANY CLAIM RELATED TO THE SERVICE WILL NOT EXCEED THE GREATER OF
                    (a) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE
                    TO THE CLAIM, OR (b) ONE HUNDRED U.S. DOLLARS (USD 100). NOTHING IN THESE TERMS LIMITS LIABILITY THAT
                    CANNOT BE LIMITED UNDER APPLICABLE LAW.
                </P>
            </Section>

            <Section title="11. Indemnification">
                <P>
                    You will defend, indemnify and hold Prisfol harmless from any claim, demand or damages (including
                    reasonable legal fees) arising out of (a) your use of the Service in breach of these Terms,
                    (b) Your Content, or (c) your violation of any third-party rights or applicable law.
                </P>
            </Section>

            <Section title="12. Termination">
                <P>
                    You may stop using the Service at any time and may cancel a paid subscription as described in the
                    Refund &amp; Cancellation Policy. We may suspend or terminate your access immediately if you breach
                    these Terms or if continued provision of the Service is no longer commercially or legally viable.
                    Sections that by their nature should survive termination (including IP, disclaimers, limitations of
                    liability, indemnification and governing law) will survive.
                </P>
            </Section>

            <Section title="13. Changes to These Terms">
                <P>
                    We may update these Terms from time to time. If a change is material we will give you reasonable
                    notice (for example by email or in-product notice) before it takes effect. Continued use of the
                    Service after the effective date constitutes acceptance of the updated Terms.
                </P>
            </Section>

            <Section title="14. Governing Law & Disputes">
                <P>
                    These Terms are governed by the laws of the State of Israel, without regard to conflict-of-laws
                    principles. The competent courts of Tel Aviv-Jaffa, Israel will have exclusive jurisdiction over any
                    dispute arising out of or relating to these Terms or the Service, except that we may seek injunctive
                    relief in any competent court to protect our intellectual property.
                </P>
            </Section>

            <Section title="15. Contact">
                <P>
                    Questions about these Terms? Reach us at{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
            </Section>
        </article>
    );
}
