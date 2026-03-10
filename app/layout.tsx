import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import AppLayout from '@/components/layout/AppLayout';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

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
    themeColor: '#05070a',
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
};

// Anti-flash script - runs before React hydration to prevent theme flash
const themeScript = `
(function() {
  try {
    const isHome = window.location.pathname === '/';
    if (isHome) {
      document.documentElement.setAttribute('data-theme', 'midnight-slate');
      document.documentElement.classList.add('dark');
      return;
    }

    const theme = localStorage.getItem('prism-theme') || 'midnight-slate';
    let resolved = theme;
    if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'modern-dark' : 'modern-light';
    } else if (theme === 'dark') {
      resolved = 'modern-dark';
    } else if (theme === 'light') {
      resolved = 'modern-light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
    if (resolved.includes('dark') || resolved === 'oceanic-neon' || resolved === 'midnight-slate') {
      document.documentElement.classList.add('dark');
    }
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
            <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans`}>
                <ThemeProvider>
                    <AppLayout>{children}</AppLayout>
                </ThemeProvider>
                <SpeedInsights />
                <Analytics />
            </body>
        </html>
    );
}
