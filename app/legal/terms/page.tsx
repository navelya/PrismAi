import { LegalHeader, Section, P, UL, Strong } from '@/components/legal/LegalProse';

export const metadata = {
    title: 'Terms of Service — Prisfol',
    description: 'The terms governing your use of Prisfol.',
};

export default function TermsPage() {
    return (
        <article>
            <LegalHeader tag="Legal" title="Terms of Service" updated="June 18, 2026" />

            <Section title="1. Agreement">
                <P>
                    These Terms of Service (&quot;<Strong>Terms</Strong>&quot;) form a binding agreement between you
                    (&quot;<Strong>you</Strong>&quot;, &quot;<Strong>your</Strong>&quot;) and Prisfol
                    (&quot;<Strong>Prisfol</Strong>&quot;, &quot;<Strong>we</Strong>&quot;, &quot;<Strong>us</Strong>&quot;),
                    operated by Naveh Elya (Israel), governing your access to and use of the Prisfol platform,
                    website, APIs and related services (collectively, the &quot;<Strong>Service</Strong>&quot;). By creating
                    an account or using the Service you confirm that you have read, understood and agree to be bound by these
                    Terms and our{' '}
                    <a href="/legal/privacy" className="text-accent-primary hover:underline">Privacy Policy</a>.
                    IF YOU DO NOT AGREE WITH THESE TERMS, YOU MUST NOT USE THE SERVICE.
                </P>
                <P>
                    If you are using the Service on behalf of an organization, you represent that you have authority to bind
                    that organization to these Terms.
                </P>
            </Section>

            <Section title="2. The Service">
                <P>
                    Prisfol is a chat-first automation platform that lets users build visual workflows which orchestrate
                    third-party AI models to generate, edit and process images, video, audio and other creative assets,
                    including text-to-speech and voice generation. Outputs are produced by external AI providers and are
                    inherently probabilistic: identical inputs may produce different results, and outputs may contain
                    inaccuracies.
                </P>
            </Section>

            <Section title="3. Eligibility & Accounts">
                <UL>
                    <li>You must be at least 13 years old to use the Service. If you are between 13 and 18 (or the age of majority in your jurisdiction), you may only use the Service with the consent and supervision of a parent or legal guardian. Where your jurisdiction sets a higher minimum age for data-processing consent (for example 16 under the GDPR in some EU member states), you must meet that age or have the required parental consent.</li>
                    <li>You are responsible for the accuracy of the information you provide and for keeping your credentials secure.</li>
                    <li>You are responsible for all activity that occurs under your account.</li>
                    <li>Each account is registered to a single user. You may not resell, sublicense or commercially redistribute account access to third parties; the account holder remains responsible for all activity and credit usage under the account.</li>
                    <li>You must promptly notify us at <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a> of any unauthorized use.</li>
                </UL>
            </Section>

            <Section title="4. Plans, Credits & Billing">
                <P>
                    The Service is offered on free and paid plans. Paid plans are billed in advance on a recurring basis
                    (monthly or annual, as selected at checkout). One-time credit packs may also be purchased and consumed
                    alongside subscription credits. Payment processing is handled by{' '}
                    <Strong>Dodo Payments</Strong>, which acts as the
                    Merchant of Record for your purchase. Dodo Payments is responsible for collecting and remitting any
                    applicable sales tax, VAT or GST based on your billing location. By purchasing a plan or credit pack
                    you also agree to Dodo Payments&apos; applicable Buyer Terms.
                </P>
                <UL>
                    <li><Strong>Credits.</Strong> Generative actions consume credits. Free credits, plan credits and purchased credits may have different expiration and rollover rules disclosed at the point of purchase.</li>
                    <li><Strong>Renewals.</Strong> Subscriptions renew automatically until cancelled.</li>
                    <li><Strong>Subscription price changes.</Strong> We may change subscription pricing with at least 30 days&apos; notice; changes take effect at your next renewal. While you maintain a continuous, uncancelled subscription, your plan rate stays locked in — increases apply only to new subscribers or to users who cancel and re-subscribe.</li>
                    <li><Strong>Credit-cost adjustments.</Strong> The credit cost of individual AI models reflects our underlying provider costs and may change at any time, including for existing subscribers, to keep the Service sustainable. We will notify users of significant changes through the Service or by email.</li>
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
                    images, video, audio, brand assets, configurations) and the outputs the Service generates from those
                    inputs (&quot;<Strong>Outputs</Strong>&quot;).
                </P>
                <UL>
                    <li><Strong>Inputs.</Strong> You retain all rights to inputs you submit. You grant Prisfol a worldwide, non-exclusive, royalty-free license to host, process, transmit and modify those inputs solely as needed to operate the Service for you.</li>
                    <li><Strong>Outputs.</Strong> As between you and Prisfol, you own the Outputs you generate, to the maximum extent permitted by applicable law and by the terms of the underlying AI providers. You are responsible for verifying that you have the rights necessary to use the Outputs for your intended purpose.</li>
                    <li><Strong>AI provider terms.</Strong> Outputs are produced through third-party model providers (such as Replicate-hosted models, Google&apos;s Gemini, ElevenLabs and others). Their terms may impose additional restrictions (for example on commercial use of certain models). You are responsible for complying with those terms.</li>
                    <li><Strong>No exclusivity.</Strong> Generative AI outputs are not unique. Other users may receive substantially similar Outputs from similar inputs.</li>
                    <li><Strong>Platform content.</Strong> The Service software, designs, branding and the Prisfol name and logos are owned by us and are licensed to you only for permitted use of the Service. This does not include Outputs you generate, which you own as described above.</li>
                    <li><Strong>Feedback.</Strong> If you send us suggestions, ideas or feedback about the Service, you grant us a perpetual, irrevocable, worldwide, royalty-free license to use them for any purpose without restriction or compensation to you.</li>
                    <li><Strong>Improving the Service.</Strong> We may use aggregated, de-identified data derived from usage to operate, maintain and improve the Service. We do not use your inputs or Outputs to train foundation models.</li>
                </UL>
            </Section>

            <Section title="6. Acceptable Use">
                <P>
                    You may use Outputs for your own purposes (including commercial use, subject to Section 5), but you may
                    not misuse the Service itself. You agree that you will not, and will not permit any third party to, use
                    the Service to:
                </P>
                <UL>
                    <li>Generate content that is illegal, defamatory, harassing, hateful, abusive, or that promotes violence, self-harm or discrimination against any person or group.</li>
                    <li>Generate child sexual abuse material, or any sexually explicit content involving minors, or non-consensual intimate imagery (including sexual deepfakes of real persons).</li>
                    <li>Infringe the intellectual property, privacy, publicity or other rights of any person, including creating unauthorized reproductions of copyrighted characters, logos or branded content.</li>
                    <li>Generate the likeness or voice of a real person without authorization, or impersonate a person or mislead about authorship for fraudulent or deceptive purposes.</li>
                    <li>Create malware, phishing material, or content intended to compromise security.</li>
                    <li>Reverse engineer, decompile, scrape at scale, or otherwise circumvent technical or content-safety limits of the Service.</li>
                    <li>Resell, sublicense or expose the Service as a competing API, or use it to build a competing product, without our written permission.</li>
                    <li>Use the Service in violation of any applicable export-control or sanctions law.</li>
                </UL>
                <P>
                    In addition, you may not use the Service for any practice prohibited under the EU AI Act or comparable
                    law, including: social scoring of individuals; biometric categorization to infer race, political
                    opinions, trade-union membership, religious or philosophical beliefs, or sexual orientation; untargeted
                    scraping of facial images to build facial-recognition databases; real-time remote biometric
                    identification in public spaces; emotion inference in workplaces or schools (except for medical or safety
                    reasons); and subliminal or manipulative techniques, or exploitation of vulnerable groups, designed to
                    materially distort behaviour and cause harm.
                </P>
            </Section>

            <Section title="7. Content Moderation & Enforcement">
                <P>
                    To comply with the acceptable-use policies of our third-party AI providers and to keep the platform
                    safe, we operate automated content moderation in the generation flow. Requests that violate our
                    policies may be blocked, and you will generally be notified when that happens. No automated system is
                    perfect; some content may bypass our safeguards, and you remain solely responsible for the prompts you
                    submit and the content you generate.
                </P>
                <P>
                    <Strong>NSFW &amp; adult content.</Strong> Prisfol does not support the generation of NSFW or adult
                    content, and we take active measures to prevent it. Intentional attempts to circumvent these protections
                    are a breach of these Terms.
                </P>
                <P>
                    Violations are tracked against your account. Repeated or severe violations may result in throttling,
                    temporary suspension, or permanent termination at our reasonable discretion, and we may remove
                    offending content and report unlawful activity to the authorities.
                </P>
            </Section>

            <Section title="8. AI Models, Availability & Fair Use">
                <P>
                    The Service integrates multiple third-party AI models. We do not guarantee the perpetual availability of
                    any specific model: a model may be discontinued, deprecated, re-priced or restricted by its provider, or
                    become unavailable for technical or regulatory reasons. We may substitute any model with an equivalent or
                    comparable alternative at our reasonable discretion, and we make no guarantee of feature parity between
                    models.
                </P>
                <P>
                    The Service is intended for normal, reasonable use. We may monitor usage and act on patterns that abuse
                    the Service — for example excessive automated requests, attempts to circumvent credit or rate limits, or
                    bulk generation intended to strain system resources. Where we detect such abuse we may throttle, suspend
                    or terminate access; we will try to notify you first except in cases of severe abuse.
                </P>
            </Section>

            <Section title="9. Third-Party Services">
                <P>
                    The Service relies on third-party providers — including Supabase (database and auth), Dodo Payments
                    (payments and tax), Vercel (hosting and analytics), and AI model providers such as Replicate, Google
                    (Gemini), ElevenLabs and other generation providers. Their performance is outside our control and is
                    governed by their own terms. We are not responsible for failures or losses caused by these providers,
                    except as required by law.
                </P>
            </Section>

            <Section title="10. Service Availability">
                <P>
                    We work to keep the Service available but do not guarantee uninterrupted operation. We may perform
                    maintenance, modify or remove features, or limit usage. We may also impose rate limits and other technical
                    safeguards to protect platform stability. Free plans are provided on an &quot;as available&quot; basis
                    and may be modified or discontinued at any time. We will not be liable for any loss caused by your
                    inability to access or use the Service during downtime or discontinuance.
                </P>
            </Section>

            <Section title="11. Disclaimer of Warranties">
                <P>
                    <Strong>AI notice.</Strong> The Service uses artificial-intelligence models provided by third parties.
                    AI-generated content may be inaccurate, incomplete, biased, or otherwise inappropriate, and may not
                    reflect real people, facts or events. You must review and verify Outputs before relying on them, and you
                    are responsible for how you use them.
                </P>
                <P>
                    THE SERVICE AND ALL OUTPUTS ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;, WITHOUT
                    WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY OR OTHERWISE. PRISFOL EXPRESSLY DISCLAIMS
                    ALL WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND THAT THE
                    SERVICE WILL BE ERROR-FREE, SECURE OR UNINTERRUPTED. WE DO NOT WARRANT THE ACCURACY, COMPLETENESS OR
                    USEFULNESS OF ANY OUTPUT. NOTHING IN THESE TERMS EXCLUDES ANY WARRANTY THAT CANNOT BE EXCLUDED UNDER
                    APPLICABLE LAW.
                </P>
            </Section>

            <Section title="12. Limitation of Liability">
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
                    CANNOT BE LIMITED UNDER APPLICABLE LAW, INCLUDING MANDATORY EU/UK CONSUMER-PROTECTION RIGHTS.
                </P>
            </Section>

            <Section title="13. Indemnification">
                <P>
                    You will defend, indemnify and hold Prisfol harmless from any claim, demand or damages (including
                    reasonable legal fees) arising out of (a) your use of the Service in breach of these Terms,
                    (b) Your Content, or (c) your violation of any third-party rights or applicable law.
                </P>
            </Section>

            <Section title="14. Termination">
                <P>
                    You may stop using the Service at any time and may cancel a paid subscription as described in the
                    Refund &amp; Cancellation Policy. We may suspend or terminate your access immediately if you breach
                    these Terms or if continued provision of the Service is no longer commercially or legally viable.
                    Deleting your account is separate from cancelling a subscription and is handled as described in our{' '}
                    <a href="/legal/privacy" className="text-accent-primary hover:underline">Privacy Policy</a>
                    {' '}(including the 30-day soft-delete window and retention of financial records). Sections that by their
                    nature should survive termination (including IP, disclaimers, limitations of liability, indemnification
                    and governing law) will survive.
                </P>
            </Section>

            <Section title="15. Changes to These Terms">
                <P>
                    We may update these Terms from time to time. If a change is material we will give you reasonable
                    notice (for example by email or in-product notice) before it takes effect. Continued use of the
                    Service after the effective date constitutes acceptance of the updated Terms.
                </P>
            </Section>

            <Section title="16. Governing Law & Disputes">
                <P>
                    These Terms are governed by the laws of the State of Israel, without regard to conflict-of-laws
                    principles. The competent courts of Tel Aviv-Jaffa, Israel will have exclusive jurisdiction over any
                    dispute arising out of or relating to these Terms or the Service, except that we may seek injunctive
                    relief in any competent court to protect our intellectual property.
                </P>
                <P>
                    Nothing in this section removes any protection you have under mandatory consumer-protection law. If you
                    are a consumer resident in the European Union or the United Kingdom, you may also bring proceedings in
                    the courts of your country of residence where mandatory law gives you that right.
                </P>
            </Section>

            <Section title="17. Contact">
                <P>
                    Prisfol is operated by Naveh Elya, Israel. Questions about these Terms? Reach us at{' '}
                    <a href="mailto:support@prisfol.com" className="text-accent-primary hover:underline">support@prisfol.com</a>.
                </P>
            </Section>
        </article>
    );
}
