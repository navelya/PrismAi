import { LegalHeader, Section, P, UL, Strong } from '@/components/legal/LegalProse';

export const metadata = {
    title: 'Privacy Policy — Prisfol',
    description: 'How Prisfol collects, uses and protects your information.',
};

export default function PrivacyPage() {
    return (
        <article>
            <LegalHeader tag="Legal" title="Privacy Policy" updated="June 18, 2026" />

            <Section title="1. Who we are">
                <P>
                    This Privacy Policy explains how Prisfol (&quot;<Strong>Prisfol</Strong>&quot;,
                    &quot;<Strong>we</Strong>&quot;, &quot;<Strong>us</Strong>&quot;), operated by Naveh Elya
                    (Israel), collects, uses, shares and protects information when you use the Prisfol
                    website, platform and APIs (the &quot;<Strong>Service</Strong>&quot;).
                    For privacy questions you can reach us at{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
            </Section>

            <div className="mb-12 rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="font-display normal-case font-semibold tracking-tight text-content-primary text-lg mb-4">
                    Key points
                </h2>
                <ul className="list-disc pl-5 space-y-2 text-[15px] leading-relaxed text-content-secondary marker:text-content-tertiary max-w-[68ch]">
                    <li>You own all content you generate through our AI tools — we don&apos;t claim ownership of your outputs.</li>
                    <li>We don&apos;t sell your personal information.</li>
                    <li>Your prompts and inputs are sent to the AI providers that power each step so they can generate your content.</li>
                    <li>We don&apos;t use your prompts, uploaded assets or outputs to train AI models.</li>
                    <li>AI-generated outputs are increasingly machine-marked; when you share them you should disclose that they are AI-generated and must not strip any marker that is present.</li>
                    <li>You can delete your account or content at any time — we delete or anonymize it within 30 days, except records we must keep for tax law.</li>
                    <li>Your data is processed in Israel (EU-adequate), the European Union and the United States.</li>
                </ul>
            </div>

            <Section title="2. Information we collect">
                <P>We collect the following categories of information:</P>
                <UL>
                    <li><Strong>Account information.</Strong> When you create an account we collect your email address and authentication identifiers. If you sign in with a third-party provider, we receive a basic profile (name, email, avatar URL).</li>
                    <li><Strong>Content you submit.</Strong> Prompts, uploaded images, video and audio files, brand assets, workflows, node configurations and any other content you create or store in the Service.</li>
                    <li><Strong>Generated outputs.</Strong> Images, video, audio and other assets produced by the AI providers we orchestrate on your behalf, together with metadata about the generation (model used, parameters, timestamps, credits consumed).</li>
                    <li><Strong>Billing information.</Strong> When you subscribe or buy credits, our Merchant of Record Dodo Payments collects your payment-method details and billing address directly. We receive a customer ID, plan, billing status and the last four digits / brand of your card — we do not store full card numbers on our servers. Dodo Payments is responsible for sales tax / VAT collection and the issuing of invoices.</li>
                    <li><Strong>Usage and device data.</Strong> IP address, user agent, pages viewed, performance metrics and high-level interaction events, collected to operate, secure and improve the Service.</li>
                    <li><Strong>Communications.</Strong> If you email us, we keep the contents of those messages.</li>
                </UL>
            </Section>

            <Section title="3. How we use your information">
                <UL>
                    <li>Provide, operate and maintain the Service, including running your workflows and storing your assets.</li>
                    <li>Process your inputs through the AI models you select and deliver the outputs back to you.</li>
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
                    <li><Strong>Consent.</Strong> For non-essential cookies and analytics where required, for optional marketing communications, and before we process voice samples you upload.</li>
                    <li><Strong>Legal obligation.</Strong> To meet tax, accounting and other regulatory requirements.</li>
                </UL>
            </Section>

            <Section title="5. Service providers we share data with">
                <P>
                    We share information with the following infrastructure processors strictly to operate the Service.
                    Each provider is bound by confidentiality and data-processing obligations.
                </P>
                <UL>
                    <li><Strong>Supabase</Strong> — managed Postgres, authentication and file storage that hosts your account, content and generated assets.</li>
                    <li><Strong>Vercel</Strong> — application hosting, edge runtime, performance metrics and product analytics.</li>
                    <li><Strong>Dodo Payments</Strong> — Merchant of Record for all purchases. Handles checkout, subscription management, invoice issuing, and global sales tax / VAT collection and remittance. Dodo Payments&apos; privacy policy applies to the data it collects directly from you at checkout.</li>
                    <li><Strong>Resend</Strong> — transactional and administrative email delivery.</li>
                </UL>
                <P>
                    AI model providers that process your prompts and media are listed separately in Section 6.
                </P>
                <P>
                    We may also disclose information when required by law, to enforce our Terms, to protect our rights or
                    those of our users, or in connection with a merger, acquisition or sale of assets (in which case we will
                    notify affected users where practical).
                </P>
            </Section>

            <Section title="6. AI content, ownership and AI providers">
                <P>
                    <Strong>Ownership.</Strong> You own the outputs you generate through our AI tools. We do not claim
                    ownership of your content and do not use your outputs for any purpose other than delivering them to
                    you. We do not train our own models on your prompts, uploaded media or generated outputs.
                </P>
                <P>
                    <Strong>AI model sub-processors.</Strong> To deliver the feature you requested, we transmit your
                    prompts and uploaded reference media to the third-party AI model provider that powers the step you run.
                    The current list of providers includes:
                </P>
                <UL>
                    <li><Strong>Anthropic (Claude)</Strong> — powers the chat assistant that helps you build and edit workflows.</li>
                    <li><Strong>Google (Gemini)</Strong> — large-language-model and image-model inference for orchestration and generation.</li>
                    <li><Strong>Replicate</Strong> — runs many of the image and video models used to generate and process media, including via webhook callbacks.</li>
                    <li><Strong>ElevenLabs</Strong> — speech and audio generation when you use voice / text-to-speech features.</li>
                    <li><Strong>FAL, WaveSpeed, KIE and Kinovi</Strong> — additional generation providers that run specific image, video and audio models.</li>
                </UL>
                <P>
                    Each provider operates under its own privacy and data-handling terms; please review them if you need
                    detail on a specific model. Where a provider offers a no-training or zero-retention mode we use it when
                    available; otherwise the provider&apos;s standard terms apply. For a current list of sub-processors,
                    contact{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
                <P>
                    <Strong>Voice and audio.</Strong> If you upload voice or audio samples to use a speech feature, those
                    samples are sent to our audio AI provider to generate your output. You must confirm you have the right
                    to use any voice sample you upload. Voice recordings may constitute biometric data under certain laws
                    (e.g. GDPR Art. 9, BIPA); we process them only to deliver the feature you requested and never sell or
                    share them for any third party&apos;s own purposes.
                </P>
                <P>
                    <Strong>Synthetic-media marking (EU AI Act Article 50).</Strong> Outputs of the Service are
                    AI-generated. We are progressively adding machine-readable markers — such as C2PA / Content Credentials
                    and embedded metadata, where our upstream providers supply them — to AI-generated outputs, with the goal
                    of meeting the EU AI Act Article 50 requirements. Coverage today is partial and varies by tool and
                    provider. Regardless of marking, when you publish or share outputs you should disclose that they are
                    AI-generated and must not remove any marker that is present.
                </P>
            </Section>

            <Section title="7. International data transfers">
                <P>
                    The providers above operate in the United States, the European Union, Israel and other regions.
                    Israel has been recognized by the European Commission as providing adequate data protection
                    (Decision 2011/61/EU). Where personal data is transferred out of the EEA / UK to a country without an
                    adequacy decision, we rely on appropriate safeguards such as the European Commission&apos;s Standard
                    Contractual Clauses or equivalent mechanisms.
                </P>
            </Section>

            <Section title="8. Data retention">
                <UL>
                    <li><Strong>Account &amp; content.</Strong> Retained for as long as your account is active.</li>
                    <li><Strong>After deletion.</Strong> When you delete your account or specific content, we delete or anonymize it within 30 days, except where we are required to retain records (e.g. invoices for tax purposes — typically up to 7 years).</li>
                    <li><Strong>Logs &amp; usage data.</Strong> Operational logs are retained for up to 90 days; aggregated analytics may be kept longer in de-identified form.</li>
                </UL>
            </Section>

            <Section title="9. Your rights">
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

            <Section title="10. Cookies and similar technologies">
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

            <Section title="11. Security">
                <P>
                    We use industry-standard safeguards including TLS in transit, encryption at rest on our database
                    provider, role-based access controls and Supabase Row-Level Security to limit access to your data.
                    No method of transmission or storage is 100% secure; if we become aware of a breach affecting your
                    personal information we will notify you and the relevant authorities as required by law.
                </P>
            </Section>

            <Section title="12. Children">
                <P>
                    The Service is intended for users who are at least 13 years old. Users between 13 and 18 must have
                    permission from a parent or legal guardian. We do not knowingly collect personal information from
                    children under 13. In jurisdictions where the minimum age for data-processing consent is higher (for
                    example 16 under the GDPR in some EU member states), users below that age require parental consent.
                    If you believe a child has provided us with personal information without the required consent, contact
                    us and we will delete it.
                </P>
            </Section>

            <Section title="13. Changes to this policy">
                <P>
                    We may update this Privacy Policy from time to time. If a change is material, we will provide notice
                    (for example by email or in-product banner) before it takes effect. The &quot;Last updated&quot; date
                    above always reflects the current version.
                </P>
            </Section>

            <Section title="14. Contact">
                <P>
                    Prisfol is operated by Naveh Elya, Israel. Privacy questions or requests:{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
            </Section>
        </article>
    );
}
