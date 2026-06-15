import { redirect } from 'next/navigation';

// Pricing now lives as a section on the marketing home (#pricing). Keep this
// path working for legacy/external links by redirecting to the section.
export default function PricingPage() {
    redirect('/#pricing');
}
