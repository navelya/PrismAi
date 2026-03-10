import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                // === SEMANTIC SURFACE TOKENS ===
                surface: {
                    primary: 'rgb(var(--bg-primary) / <alpha-value>)',
                    secondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
                    tertiary: 'rgb(var(--bg-tertiary) / <alpha-value>)',
                    elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
                },
                // === SEMANTIC TEXT TOKENS ===
                content: {
                    primary: 'rgb(var(--text-primary) / <alpha-value>)',
                    secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
                    tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
                    inverted: 'rgb(var(--text-inverted) / <alpha-value>)',
                },
                // === SEMANTIC BORDER TOKENS ===
                stroke: {
                    subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
                    DEFAULT: 'rgb(var(--border-default) / <alpha-value>)',
                    strong: 'rgb(var(--border-strong) / <alpha-value>)',
                },
                // === ACCENT COLORS ===
                accent: {
                    primary: 'rgb(var(--accent-primary) / <alpha-value>)',
                    secondary: 'rgb(var(--accent-secondary) / <alpha-value>)',
                    success: 'rgb(var(--accent-success) / <alpha-value>)',
                    error: 'rgb(var(--accent-error) / <alpha-value>)',
                    warning: 'rgb(var(--accent-warning) / <alpha-value>)',
                },
                // === INTERACTIVE STATES ===
                interactive: {
                    hover: 'rgb(var(--interactive-hover) / <alpha-value>)',
                    active: 'rgb(var(--interactive-active) / <alpha-value>)',
                },
                // === CANVAS TOKENS ===
                canvas: {
                    bg: 'rgb(var(--canvas-bg) / <alpha-value>)',
                    dots: 'rgb(var(--canvas-dots) / <alpha-value>)',
                    node: 'rgb(var(--canvas-node-bg) / <alpha-value>)',
                    text: 'rgb(var(--canvas-node-text) / <alpha-value>)',
                    subtext: 'rgb(var(--canvas-node-subtext) / <alpha-value>)',
                    edge: 'rgb(var(--canvas-edge) / <alpha-value>)',
                },
                // === LEGACY COMPATIBILITY (will be phased out) ===
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                border: "hsl(var(--border))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
            },
            backgroundImage: {
                "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
                "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
                "gradient-premium": "linear-gradient(to bottom right, rgb(var(--accent-primary)), rgb(var(--accent-secondary)))",
                "gradient-accent": "linear-gradient(135deg, rgb(var(--accent-primary)) 0%, rgb(var(--accent-secondary)) 100%)",
            },
            animation: {
                "fade-in": "fadeIn 0.5s ease-in-out",
                "slide-up": "slideUp 0.4s ease-out",
                "slide-in": "slideIn 0.3s ease-out",
                "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            },
            keyframes: {
                fadeIn: {
                    "0%": { opacity: "0" },
                    "100%": { opacity: "1" },
                },
                slideUp: {
                    "0%": { transform: "translateY(20px)", opacity: "0" },
                    "100%": { transform: "translateY(0)", opacity: "1" },
                },
                slideIn: {
                    "0%": { transform: "translateX(100%)" },
                    "100%": { transform: "translateX(0)" },
                },
            },
        },
    },
    plugins: [],
};
export default config;
