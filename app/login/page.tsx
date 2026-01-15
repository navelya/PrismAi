'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, Loader2, ArrowRight, Mail, Lock, AlertCircle, User, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [checkEmail, setCheckEmail] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();
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

                // Successful login
                // Force a hard refresh or router push to ensure middleware sees the new cookie
                // The cookie is set by our custom storage adapter in supabase client
                router.refresh();
                router.push('/chat');
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
                    // Auto-login if confirmation not required
                    router.refresh();
                    router.push('/chat');
                } else if (data.user) {
                    // Confirmation required
                    setCheckEmail(true);
                }
            }
        } catch (err: any) {
            console.error('Auth error:', err);
            setError(err.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    if (checkEmail) {
        return (
            <div className="min-h-screen w-full bg-surface-primary flex items-center justify-center p-4 relative overflow-hidden">
                <div className="w-full max-w-sm relative z-10 text-center">
                    <div className="flex justify-center mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-premium flex items-center justify-center shadow-lg shadow-accent-primary/20 animate-pulse">
                            <Mail className="w-8 h-8 text-white" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-content-primary mb-2">Check your inbox</h1>
                    <p className="text-content-secondary mb-8">
                        We sent a confirmation link to <br /> <strong className="text-content-primary">{email}</strong>
                    </p>
                    <div className="bg-surface-secondary/50 backdrop-blur-xl border border-stroke-subtle rounded-2xl p-6 shadow-xl">
                        <p className="text-sm text-content-tertiary mb-4">
                            Click the link in the email to activate your account and access Prism AI.
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
        <div className="min-h-screen w-full bg-surface-primary flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-700" />
            </div>

            <div className="w-full max-w-md relative z-10">
                {/* Logo */}
                <div className="flex justify-center mb-8">
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="w-12 h-12 rounded-xl bg-gradient-premium flex items-center justify-center shadow-lg shadow-accent-primary/20 group-hover:scale-105 transition-transform duration-300">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-content-primary">Prism AI</h1>
                            <p className="text-sm text-content-secondary">Automation Platform</p>
                        </div>
                    </Link>
                </div>

                <div className="bg-surface-secondary/50 backdrop-blur-xl border border-stroke-subtle rounded-2xl p-8 shadow-xl">
                    <h2 className="text-2xl font-bold text-content-primary mb-2 text-center">
                        {isLogin ? 'Welcome back' : 'Create an account'}
                    </h2>
                    <p className="text-content-secondary text-center mb-8">
                        {isLogin
                            ? 'Enter your credentials to access your workspace'
                            : 'Start automating your workflow today'}
                    </p>

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

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 px-4 bg-gradient-premium text-white font-medium rounded-xl 
                                       shadow-lg shadow-accent-primary/25 hover:shadow-xl hover:shadow-accent-primary/40
                                       active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
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

                    <div className="mt-8 border-t border-stroke-subtle pt-6">
                        <div className="text-center">
                            <button disabled className="text-xs text-content-tertiary cursor-not-allowed opacity-50 flex items-center justify-center gap-2 w-full">
                                <span>Google Sign In (Disabled)</span>
                            </button>
                        </div>
                        <div className="mt-4 text-center">
                            <Link href="/" className="text-xs text-content-tertiary hover:text-content-primary">
                                Back to Home
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
