'use client';

import React from 'react';
import { Sparkles, Settings2, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Select, type SelectOption } from '@/components/ui/Select';

interface ModelPickerProps {
  selectedModel: 'haiku' | 'sonnet';
  onSelect: (m: 'haiku' | 'sonnet') => void;
  isPaid: boolean;
}

const TriggerButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function TriggerButton(props, ref) {
    const { className, children, ...rest } = props;
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Select chat model"
        {...rest}
        className={`p-2 rounded-lg transition-colors bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary data-[state=open]:bg-surface-tertiary data-[state=open]:text-content-primary outline-none ${className ?? ''}`}
      >
        <Settings2 className="w-5 h-5" />
        {children}
      </button>
    );
  }
);

export function ModelPicker({ selectedModel, onSelect, isPaid }: ModelPickerProps) {
  const router = useRouter();

  const options: SelectOption[] = isPaid
    ? [
        {
          id: 'sonnet',
          display_name: 'Sonnet 4.6',
          subtitle: 'Smarter, more capable',
          icon: <Sparkles className="w-3.5 h-3.5 text-accent-primary" />,
        },
        {
          id: 'haiku',
          display_name: 'Haiku 4.5',
          subtitle: 'Faster, simpler tasks',
          icon: <Zap className="w-3.5 h-3.5 text-content-secondary" />,
        },
      ]
    : [
        {
          id: 'haiku',
          display_name: 'Automatic',
          subtitle: 'Haiku 4.5 — auto',
          icon: <Zap className="w-3.5 h-3.5 text-content-secondary" />,
        },
        {
          id: 'upgrade',
          display_name: 'Upgrade for Sonnet',
          subtitle: 'Smarter, more capable',
          icon: <Sparkles className="w-3.5 h-3.5 text-accent-primary" />,
        },
      ];

  const value = isPaid ? selectedModel : 'haiku';

  const handleChange = (e: { target: { value: string } }) => {
    const v = e.target.value;
    if (v === 'upgrade') {
      router.push('/settings?tab=plan-billing');
      return;
    }
    if (v === 'sonnet' || v === 'haiku') onSelect(v);
  };

  return (
    <Select
      variant="minimal"
      options={options}
      value={value}
      onChange={handleChange}
      triggerNode={<TriggerButton />}
    />
  );
}
