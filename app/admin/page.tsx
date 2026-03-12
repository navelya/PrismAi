'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Boxes,
    ArrowLeft,
    Plus,
    Save,
    AlertCircle,
    CheckCircle2,
    Database,
    Type,
    Layers,
    Code,
    Activity
} from 'lucide-react';
import { modelsAdminApi } from '@/lib/api/admin';

// =============================================================================
// UI COMPONENTS (Mirroring Settings Page Design)
// =============================================================================

interface FormSectionProps {
    title: string;
    description: string;
    children: React.ReactNode;
}

function FormSection({ title, description, children }: FormSectionProps) {
    return (
        <div className="py-8 border-b border-stroke-subtle last:border-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1">
                    <h3 className="font-medium text-content-primary">{title}</h3>
                    <p className="text-sm mt-1 text-content-secondary">{description}</p>
                </div>
                <div className="md:col-span-2 space-y-4">
                    {children}
                </div>
            </div>
        </div>
    );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    error?: string;
}

function Input({ label, error, className = '', ...props }: InputProps) {
    return (
        <div className="space-y-1.5 flex-1">
            <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">
                {label}
            </label>
            <input
                {...props}
                className={`w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all ${error ? 'border-red-500' : ''} ${className}`}
            />
            {error && <p className="text-xs text-red-500 pl-1">{error}</p>}
        </div>
    );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function AdminPage() {
    const router = useRouter();

    // Form State
    const [formData, setFormData] = useState({
        replicate_model_id: '',
        display_name: '',
        task_type: '',
        credit_cost: 0,
        is_active: true,
        category_id: '',
        archetype_id: '',
        inputs_schema: JSON.stringify({ handles: [], controls: [] }, null, 2),
        outputs_schema: JSON.stringify({ handles: [] }, null, 2)
    });

    // Options for dropdowns
    const [categories, setCategories] = useState<any[]>([]);
    const [archetypes, setArchetypes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    useEffect(() => {
        async function loadOptions() {
            try {
                const [cats, archs] = await Promise.all([
                    modelsAdminApi.listCategories(),
                    modelsAdminApi.listArchetypes()
                ]);
                setCategories(cats);
                setArchetypes(archs);

                // Set defaults if data exists
                if (cats.length > 0) setFormData(prev => ({ ...prev, category_id: cats[0].id }));
                if (archs.length > 0) setFormData(prev => ({ ...prev, archetype_id: archs[0].id }));
            } catch (err) {
                console.error('Failed to load options:', err);
                setStatus({ type: 'error', message: 'Failed to load form options (Categories/Archetypes).' });
            } finally {
                setLoading(false);
            }
        }
        loadOptions();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
        setFormData(prev => ({ ...prev, [name]: val }));
    };

    const validateJson = (jsonStr: string) => {
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            return null;
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus(null);

        // JSON Validation
        const inputs = validateJson(formData.inputs_schema);
        const outputs = validateJson(formData.outputs_schema);

        if (!inputs) {
            setStatus({ type: 'error', message: 'Invalid JSON in Inputs Schema' });
            return;
        }
        if (!outputs) {
            setStatus({ type: 'error', message: 'Invalid JSON in Outputs Schema' });
            return;
        }

        setSubmitting(true);
        try {
            await modelsAdminApi.createModel({
                ...formData,
                inputs_schema: inputs,
                outputs_schema: outputs,
                credit_cost: Number(formData.credit_cost)
            });
            setStatus({ type: 'success', message: 'Model created successfully!' });
            // Reset form except schemas
            setFormData(prev => ({
                ...prev,
                replicate_model_id: '',
                display_name: '',
                task_type: '',
                credit_cost: 0
            }));
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to create model.' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-surface-secondary overflow-y-auto">
            {/* Header */}
            <header className="sticky top-0 z-20 bg-surface-primary border-b border-stroke-subtle px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.back()}
                        className="p-2 -ml-2 rounded-lg hover:bg-surface-tertiary transition-colors text-content-secondary"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2">
                            <Boxes className="w-5 h-5 text-accent-primary" />
                            <h1 className="text-xl font-bold text-content-primary">Admin Panel</h1>
                        </div>
                        <p className="text-xs text-content-tertiary">Node Registry Management</p>
                    </div>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={submitting || loading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-premium text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-accent-primary/20"
                >
                    {submitting ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <Save className="w-4 h-4" />
                    )}
                    <span>Save Model</span>
                </button>
            </header>

            <main className="flex-1 max-w-4xl mx-auto w-full p-6 md:p-10">
                {status && (
                    <div className={`mb-8 p-4 rounded-xl border flex items-start gap-3 animate-in fade-in slide-in-from-top-4 ${status.type === 'success'
                            ? 'bg-green-500/10 border-green-500/20 text-green-600'
                            : 'bg-red-500/10 border-red-500/20 text-red-600'
                        }`}>
                        {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                        <p className="text-sm font-medium">{status.message}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <FormSection
                        title="Model Identification"
                        description="Core identifiers for the model. Replicate ID must match exactly."
                    >
                        <div className="flex flex-col sm:flex-row gap-4">
                            <Input
                                label="Replicate Model ID"
                                name="replicate_model_id"
                                value={formData.replicate_model_id}
                                onChange={handleChange}
                                placeholder="e.g. stability-ai/sdxl:..."
                                required
                            />
                            <Input
                                label="Display Name"
                                name="display_name"
                                value={formData.display_name}
                                onChange={handleChange}
                                placeholder="e.g. SDXL Base"
                                required
                            />
                        </div>
                        <Input
                            label="Task Type (Optional)"
                            name="task_type"
                            value={formData.task_type}
                            onChange={handleChange}
                            placeholder="e.g. image_generation"
                        />
                    </FormSection>

                    <FormSection
                        title="Categorization & Archetype"
                        description="Define where this model sits in the UI and what component skeleton it uses."
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Category</label>
                                <select
                                    name="category_id"
                                    value={formData.category_id}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all appearance-none"
                                >
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.display_name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Node Archetype</label>
                                <select
                                    name="archetype_id"
                                    value={formData.archetype_id}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all appearance-none"
                                >
                                    {archetypes.map(arch => (
                                        <option key={arch.id} value={arch.id}>{arch.component_name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </FormSection>

                    <FormSection
                        title="Cost & Status"
                        description="Manage model accessibility and token economy."
                    >
                        <div className="flex items-center gap-8">
                            <Input
                                label="Credit Cost"
                                name="credit_cost"
                                type="number"
                                value={formData.credit_cost}
                                onChange={handleChange}
                                className="max-w-[150px]"
                            />
                            <div className="flex items-center gap-3 pt-5">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        name="is_active"
                                        checked={formData.is_active}
                                        onChange={handleChange}
                                        id="is_active"
                                        className="sr-only peer"
                                    />
                                    <div
                                        onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                                        className="w-11 h-6 bg-surface-tertiary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-content-tertiary after:border-stroke-subtle after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 after:peer-checked:bg-white cursor-pointer"
                                    ></div>
                                </div>
                                <label htmlFor="is_active" className="text-sm font-medium text-content-primary cursor-pointer select-none">
                                    Is Active
                                </label>
                            </div>
                        </div>
                    </FormSection>

                    <FormSection
                        title="Node Definition (JSON)"
                        description="Define handles and controls for the node runtime."
                    >
                        <div className="space-y-6">
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between px-1">
                                    <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider">Inputs Schema</label>
                                    <Code className="w-3.5 h-3.5 text-content-tertiary" />
                                </div>
                                <textarea
                                    name="inputs_schema"
                                    value={formData.inputs_schema}
                                    onChange={handleChange}
                                    rows={8}
                                    className="w-full px-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary font-mono text-xs focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all resize-y"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between px-1">
                                    <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider">Outputs Schema</label>
                                    <Code className="w-3.5 h-3.5 text-content-tertiary" />
                                </div>
                                <textarea
                                    name="outputs_schema"
                                    value={formData.outputs_schema}
                                    onChange={handleChange}
                                    rows={6}
                                    className="w-full px-4 py-3 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary font-mono text-xs focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all resize-y"
                                />
                            </div>
                        </div>
                    </FormSection>

                    <div className="pt-8 flex justify-end">
                        <button
                            type="submit"
                            disabled={submitting || loading}
                            className="px-8 py-3 bg-gradient-premium text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-xl shadow-accent-primary/30 flex items-center gap-2"
                        >
                            {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                            Create AI Model
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
}
