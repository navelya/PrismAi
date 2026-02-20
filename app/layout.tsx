import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppLayout from '@/components/layout/AppLayout';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'Prism AI - Chat-First Automation Platform',
    description: 'Transform natural language commands into powerful automation workflows for graphic design',
    keywords: ['automation', 'AI', 'workflow', 'graphic design', 'no-code'],
    manifest: '/manifest.json',
    appleWebApp: {
        capable: true,
        statusBarStyle: 'default',
        title: 'Prism AI',
    },
    other: {
        'mobile-web-app-capable': 'yes',
    },
};

export const viewport = {
    themeColor: '#7c3aed',
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

// Anti-flash script - runs before React hydration to prevent theme flash
const themeScript = `
(function() {
  try {
    const theme = localStorage.getItem('prism-theme') || 'system';
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {}
})();
`;

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script
                    dangerouslySetInnerHTML={{ __html: themeScript }}
                />
            </head>
            <body className={inter.className}>
                <ThemeProvider>
                    <AppLayout>{children}</AppLayout>
                </ThemeProvider>
            </body>
        </html>
    );
}
