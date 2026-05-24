import React from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
    title: 'Pricing — Prisfol',
    description: 'Plans and credit packs for the Prisfol platform.',
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen w-full bg-white text-slate-900">
            <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
                <div className="max-w-4xl mx-auto px-6 md:px-8 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 group">
                        <ArrowLeft className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 transition-colors" />
                        <Logo variant="wordmark" className="h-5 w-auto text-slate-900" />
                    </Link>
                    <nav className="hidden sm:flex items-center gap-6 text-[7px] font-black uppercase tracking-[0.4em] text-slate-400">
                        <Link href="/pricing" className="text-slate-900">Pricing</Link>
                        <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">Terms</Link>
                        <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">Privacy</Link>
                        <Link href="/legal/refund" className="hover:text-slate-900 transition-colors">Refunds</Link>
                    </nav>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 md:px-8 py-16 md:py-24">
                {children}
            </main>

            <footer className="border-t border-slate-200">
                <div className="max-w-4xl mx-auto px-6 md:px-8 py-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                    <div className="text-[7px] font-black tracking-[0.6em] text-slate-300 uppercase">© 2026 Prisfol</div>
                    <nav className="flex flex-wrap gap-6 text-[7px] font-black uppercase tracking-[0.4em] text-slate-400">
                        <Link href="/pricing" className="hover:text-slate-900 transition-colors">Pricing</Link>
                        <Link href="/legal/terms" className="hover:text-slate-900 transition-colors">Terms of Service</Link>
                        <Link href="/legal/privacy" className="hover:text-slate-900 transition-colors">Privacy Policy</Link>
                        <Link href="/legal/refund" className="hover:text-slate-900 transition-colors">Refund Policy</Link>
                    </nav>
                </div>
            </footer>
        </div>
    );
}
