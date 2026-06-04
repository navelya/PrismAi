'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, ArrowRight, Mail, Lock, AlertCircle, User, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';

/**
 * The brand "visual side" of the split-screen login: a full-bleed generated
 * image with the logo and tagline overlaid on top. Scrims keep the text legible
 * over the artwork.
 */
function BrandPanel() {
    return (
        <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-stroke-subtle">
            {/* artwork — plain img so the browser downscales the high-res source
                directly (no optimizer recompression / banding) */}
            <img
                src="/login-hero.webp"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
            />

            {/* scrims — top for the logo, bottom for the tagline */}
            <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/50 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

            {/* content */}
            <div className="relative z-10 flex h-full flex-col justify-end p-12">
                <div className="max-w-md">
                    <p className="text-3xl font-semibold leading-tight text-white drop-shadow">
                        Create at the speed of thought.
                    </p>
                    <p className="mt-4 text-base text-white/80 drop-shadow">
                        Generate, compose, and ship visuals — all on one canvas.
                    </p>
                </div>
            </div>
        </div>
    );
}

function LoginContent() {
    const [isLogin, setIsLogin] = useState(true);
    const [checkEmail, setCheckEmail] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextPath = searchParams.get('next') || '/chat';
    const supabase = createClient();

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (isLogin) {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;

                // Successful login — honour ?next= if present
                router.refresh();
                router.push(nextPath);
            } else {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${location.origin}/auth/callback`,
                        data: {
                            full_name: fullName,
                            display_name: fullName, // explicitly saving as display_name per user request
                            name: fullName,
                        },
                    },
                });
                if (error) throw error;

                if (data.session) {
                    // Auto-login if confirmation not required — honour ?next= if present
                    router.refresh();
                    router.push(nextPath);
                } else if (data.user) {
                    // Confirmation required
                    setLoading(false);
                    setCheckEmail(true);
                }
            }
        } catch (err: any) {
            setError(err.message || 'Authentication failed');
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setGoogleLoading(true);
        setError(null);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                },
            });
            if (error) throw error;
        } catch (err: any) {
            setError(err.message || 'Google Authentication failed');
            setGoogleLoading(false);
        }
    };

    if (checkEmail) {
        return (
            <div className="min-h-screen w-full bg-surface-primary flex items-center justify-center p-4">
                <div className="w-full max-w-sm text-center">
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
                            <Mail className="w-8 h-8 text-accent-primary" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-content-primary mb-2">Check your inbox</h1>
                    <p className="text-content-secondary mb-8">
                        We sent a confirmation link to <br /> <strong className="text-content-primary">{email}</strong>
                    </p>
                    <div className="bg-surface-secondary border border-stroke-subtle rounded-2xl p-6">
                        <p className="text-sm text-content-tertiary mb-4">
                            Click the link in the email to activate your account and access Prisfol.
                        </p>
                        <button
                            onClick={() => setCheckEmail(false)}
                            className="w-full py-2.5 px-4 bg-surface-tertiary hover:bg-interactive-hover text-content-primary rounded-xl transition-colors font-medium text-sm"
                        >
                            Back to Login
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-surface-primary flex">
            {/* Left — auth */}
            <div className="flex w-full flex-col items-center justify-center px-6 py-10 lg:w-1/2">
                <div className="w-full max-w-sm">
                    {/* Logo */}
                    <div className="flex justify-center mb-8">
                        <Link href="/" className="flex items-center gap-3">
                            <Logo variant="wordmark" className="h-9 w-auto text-content-primary" />
                        </Link>
                    </div>

                    <h2 className="text-2xl font-bold text-content-primary mb-2 text-center">
                        {isLogin ? 'Welcome back' : 'Create an account'}
                    </h2>
                    <p className="text-content-secondary text-center mb-8">
                        {isLogin
                            ? 'Enter your credentials to access your workspace'
                            : 'Start automating your workflow today'}
                    </p>

                    {/* Google Login Area */}
                    <div className="mb-6">
                        <button
                            type="button"
                            onClick={handleGoogleLogin}
                            disabled={loading || googleLoading}
                            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-surface-tertiary hover:bg-interactive-hover border border-stroke-subtle text-content-primary rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {googleLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin text-accent-primary" />
                            ) : (
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l2.85-2.22.83-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                            )}
                            <span className="font-medium">{googleLoading ? 'Logging in...' : 'Continue with Google'}</span>
                        </button>
                    </div>

                    <div className="relative mb-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-stroke-subtle"></div>
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-2 bg-surface-primary text-content-tertiary">Or continue with email</span>
                        </div>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-4">
                        {/* Name Input (Sign Up Only) */}
                        {!isLogin && (
                            <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                <label className="text-sm font-medium text-content-primary ml-1">Full Name</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-tertiary" />
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl
                                                text-content-primary placeholder:text-content-tertiary
                                                focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent
                                                transition-all"
                                        placeholder="John Doe"
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {/* Email */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-content-primary ml-1">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-tertiary" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl
                                               text-content-primary placeholder:text-content-tertiary
                                               focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent
                                               transition-all"
                                    placeholder="name@example.com"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-content-primary ml-1">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-content-tertiary" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-10 pr-10 py-3 bg-surface-tertiary border border-stroke-subtle rounded-xl
                                               text-content-primary placeholder:text-content-tertiary
                                               focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent
                                               transition-all"
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-content-tertiary hover:text-content-primary transition-colors"
                                >
                                    {showPassword ? (
                                        <EyeOff className="w-5 h-5" />
                                    ) : (
                                        <Eye className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Submit Button — flat, no gradient */}
                        <button
                            type="submit"
                            disabled={loading || googleLoading}
                            className="w-full py-3 px-4 bg-accent-primary hover:bg-accent-primary/90 text-white font-medium rounded-xl
                                       shadow-sm hover:shadow-md
                                       active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2
                                       disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Toggle */}
                    <div className="mt-6 text-center">
                        <p className="text-sm text-content-secondary">
                            {isLogin ? "Don't have an account? " : "Already have an account? "}
                            <button
                                onClick={() => {
                                    setIsLogin(!isLogin);
                                    setError(null);
                                }}
                                className="font-medium text-accent-primary hover:text-accent-secondary transition-colors"
                            >
                                {isLogin ? 'Sign up' : 'Sign in'}
                            </button>
                        </p>
                    </div>

                    <div className="mt-8 text-center">
                        <Link href="/" className="text-xs text-content-tertiary hover:text-content-primary">
                            Back to Home
                        </Link>
                    </div>
                </div>
            </div>

            {/* Right — brand visual (desktop only) */}
            <div className="relative hidden p-3 lg:flex lg:w-1/2">
                <BrandPanel />
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="text-content-secondary text-sm">Loading…</span></div>}>
            <LoginContent />
        </Suspense>
    );
}
