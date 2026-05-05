import { LegalHeader, Section, P, UL, Strong } from '@/components/legal/LegalProse';

export const metadata = {
    title: 'Privacy Policy — Prisfol',
    description: 'How Prisfol collects, uses and protects your information.',
};

export default function PrivacyPage() {
    return (
        <article>
            <LegalHeader tag="Legal" title="Privacy Policy" updated="May 5, 2026" />

            <Section title="1. Who we are">
                <P>
                    This Privacy Policy explains how Prisfol (&quot;<Strong>Prisfol</Strong>&quot;,
                    &quot;<Strong>we</Strong>&quot;, &quot;<Strong>us</Strong>&quot;) collects, uses, shares and protects
                    information when you use the Prisfol website, platform and APIs (the &quot;<Strong>Service</Strong>&quot;).
                    For privacy questions you can reach us at{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
            </Section>

            <Section title="2. Information we collect">
                <P>We collect the following categories of information:</P>
                <UL>
                    <li><Strong>Account information.</Strong> When you create an account we collect your email address and authentication identifiers. If you sign in with a third-party provider, we receive a basic profile (name, email, avatar URL).</li>
                    <li><Strong>Content you submit.</Strong> Prompts, uploaded images, brand assets, workflows, node configurations and any other content you create or store in the Service.</li>
                    <li><Strong>Generated outputs.</Strong> Images and other assets produced by the AI providers we orchestrate on your behalf, together with metadata about the generation (model used, parameters, timestamps, credits consumed).</li>
                    <li><Strong>Billing information.</Strong> When you subscribe, our payment processor Stripe collects your payment-method details directly. We receive a customer ID, plan, billing status and the last four digits / brand of your card — we do not store full card numbers on our servers.</li>
                    <li><Strong>Usage and device data.</Strong> IP address, user agent, pages viewed, performance metrics and high-level interaction events, collected to operate, secure and improve the Service.</li>
                    <li><Strong>Communications.</Strong> If you email us, we keep the contents of those messages.</li>
                </UL>
            </Section>

            <Section title="3. How we use your information">
                <UL>
                    <li>Provide, operate and maintain the Service, including running your workflows and storing your assets.</li>
                    <li>Process payments, manage subscriptions and apply credit balances.</li>
                    <li>Send transactional messages (account, billing, security and material product changes).</li>
                    <li>Monitor and improve performance, debug issues, and prevent abuse, fraud and security incidents.</li>
                    <li>Comply with legal obligations and enforce our Terms of Service.</li>
                </UL>
                <P>
                    We do <Strong>not</Strong> use your prompts, uploaded assets or generated outputs to train foundation
                    AI models. We do not sell your personal information.
                </P>
            </Section>

            <Section title="4. Legal bases (EEA / UK users)">
                <P>If you are in the EEA or UK, we rely on the following bases under the GDPR / UK GDPR:</P>
                <UL>
                    <li><Strong>Contract.</Strong> To create your account, deliver the Service and process payments.</li>
                    <li><Strong>Legitimate interests.</Strong> To secure the Service, prevent abuse and improve our product.</li>
                    <li><Strong>Consent.</Strong> For non-essential cookies and analytics where required, and for optional marketing communications.</li>
                    <li><Strong>Legal obligation.</Strong> To meet tax, accounting and other regulatory requirements.</li>
                </UL>
            </Section>

            <Section title="5. Service providers we share data with">
                <P>
                    We share information with the following processors strictly to operate the Service. Each provider is
                    bound by confidentiality and data-processing obligations.
                </P>
                <UL>
                    <li><Strong>Supabase</Strong> — managed Postgres, authentication and file storage that hosts your account, content and generated assets.</li>
                    <li><Strong>Vercel</Strong> — application hosting, edge runtime, performance metrics and product analytics.</li>
                    <li><Strong>Stripe</Strong> — payment processing, subscription management and tax calculation.</li>
                    <li><Strong>Replicate</Strong> — runs the AI models used to generate and process images, including via webhook callbacks.</li>
                    <li><Strong>Google (Gemini API)</Strong> — large-language-model and image-model inference for orchestration and generation.</li>
                    <li><Strong>Hugging Face Spaces</Strong> — hosts our background-removal microservice that may receive image data for processing.</li>
                </UL>
                <P>
                    When you submit a prompt or asset to a workflow, the relevant inputs are transmitted to the AI provider
                    that powers that step. Each provider operates under its own privacy and data-handling terms; please
                    review them if you need detail on a specific model.
                </P>
                <P>
                    We may also disclose information when required by law, to enforce our Terms, to protect our rights or
                    those of our users, or in connection with a merger, acquisition or sale of assets (in which case we will
                    notify affected users where practical).
                </P>
            </Section>

            <Section title="6. International data transfers">
                <P>
                    The providers above operate in the United States, the European Union, Israel and other regions.
                    Where personal data is transferred out of the EEA / UK, we rely on appropriate safeguards such as the
                    European Commission&apos;s Standard Contractual Clauses or equivalent mechanisms.
                </P>
            </Section>

            <Section title="7. Data retention">
                <UL>
                    <li><Strong>Account &amp; content.</Strong> Retained for as long as your account is active.</li>
                    <li><Strong>After deletion.</Strong> When you delete your account or specific content, we delete or anonymize it within 30 days, except where we are required to retain records (e.g. invoices for tax purposes — typically up to 7 years).</li>
                    <li><Strong>Logs &amp; usage data.</Strong> Operational logs are retained for up to 90 days; aggregated analytics may be kept longer in de-identified form.</li>
                </UL>
            </Section>

            <Section title="8. Your rights">
                <P>
                    Depending on where you live, you may have the right to access, correct, delete, port, restrict or
                    object to processing of your personal information, and to withdraw consent at any time. EEA / UK users
                    have the right to lodge a complaint with their supervisory authority. California (CCPA / CPRA) and
                    other US-state residents have rights to know, delete, correct and opt out of any &quot;sale&quot; or
                    &quot;sharing&quot; — Prisfol does not sell or share personal information for cross-context behavioral
                    advertising.
                </P>
                <P>
                    To exercise any of these rights, email{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>{' '}
                    from the address on your account. We respond within the timeframes required by applicable law.
                </P>
            </Section>

            <Section title="9. Cookies and similar technologies">
                <P>We use a small set of cookies and equivalent technologies, grouped as follows:</P>
                <UL>
                    <li><Strong>Strictly necessary.</Strong> Authentication session tokens (Supabase), CSRF protection and load-balancing identifiers. The Service cannot function without these and they are exempt from consent requirements.</li>
                    <li><Strong>Preferences.</Strong> Local-storage entries that remember your selected theme and UI state.</li>
                    <li><Strong>Analytics &amp; performance.</Strong> Vercel Analytics and Vercel Speed Insights collect anonymized usage and performance metrics. In regions where consent is required (EEA, UK, California), these are loaded only after you accept them via our cookie banner.</li>
                </UL>
                <P>
                    You can change or withdraw your cookie choices at any time by clearing your browser storage for this
                    site, which will trigger the consent banner again on your next visit.
                </P>
            </Section>

            <Section title="10. Security">
                <P>
                    We use industry-standard safeguards including TLS in transit, encryption at rest on our database
                    provider, role-based access controls and Supabase Row-Level Security to limit access to your data.
                    No method of transmission or storage is 100% secure; if we become aware of a breach affecting your
                    personal information we will notify you and the relevant authorities as required by law.
                </P>
            </Section>

            <Section title="11. Children">
                <P>
                    The Service is not directed to children under 16, and we do not knowingly collect personal information
                    from them. If you believe a child has provided us with personal information, contact us and we will
                    delete it.
                </P>
            </Section>

            <Section title="12. Changes to this policy">
                <P>
                    We may update this Privacy Policy from time to time. If a change is material, we will provide notice
                    (for example by email or in-product banner) before it takes effect. The &quot;Last updated&quot; date
                    above always reflects the current version.
                </P>
            </Section>

            <Section title="13. Contact">
                <P>
                    Privacy questions or requests:{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
            </Section>
        </article>
    );
}
