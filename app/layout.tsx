import type { Metadata } from 'next';
import React from 'react';
// import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import AppLayout from '@/components/layout/AppLayout';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { CookieConsent } from '@/components/legal/CookieConsent';
import { CrashRecoveryProvider } from '@/components/providers/CrashRecoveryProvider';

// const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
// const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space' });

export const metadata: Metadata = {
  title: 'Prisfol - Chat-First Automation Platform',
  description: 'Transform natural language commands into powerful automation workflows for graphic design',
  keywords: ['automation', 'AI', 'workflow', 'graphic design', 'no-code'],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Prisfol',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans" style={{
        fontFamily: "'Inter', sans-serif",
        // @ts-ignore
        '--font-inter': "'Inter', sans-serif",
        '--font-space': "'Space Grotesk', sans-serif"
      } as React.CSSProperties}>
        <ThemeProvider>
          <TooltipProvider delayDuration={400} skipDelayDuration={100}>
            <CrashRecoveryProvider>
              <AppLayout>{children}</AppLayout>
            </CrashRecoveryProvider>
          </TooltipProvider>
        </ThemeProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
