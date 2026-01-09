import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppLayout from '@/components/layout/AppLayout';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'Prism AI - Chat-First Automation Platform',
    description: 'Transform natural language commands into powerful automation workflows for graphic design',
    keywords: ['automation', 'AI', 'workflow', 'graphic design', 'no-code'],
    manifest: '/manifest.json',
    themeColor: '#7c3aed',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'Prism AI',
    },
    viewport: {
        width: 'device-width',
        initialScale: 1,
        maximumScale: 1,
        userScalable: false,
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className={inter.className}>
                <AppLayout>{children}</AppLayout>
            </body>
        </html>
    );
}
