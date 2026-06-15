'use client';

import React, { useRef, useId } from 'react';
import * as RadixLabel from '@radix-ui/react-label';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NumberInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    suffix?: string;
    inputClassName?: string;
    hideArrows?: boolean;
    variant?: 'default' | 'minimal';
    /** Optional node rendered next to the label (e.g. a description info icon). */
    labelAccessory?: React.ReactNode;
}

export function NumberInput({ label, error, suffix, className, inputClassName, hideArrows = false, variant = 'default', labelAccessory, ...props }: NumberInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const defaultId = useId();
    const id = props.id || defaultId;
    const isMinimal = variant === 'minimal';

    const handleIncrement = () => {
        if (inputRef.current) {
            inputRef.current.stepUp();
            const event = new Event('change', { bubbles: true });
            inputRef.current.dispatchEvent(event);
            if (props.onChange) {
                const syntheticEvent = {
                    target: inputRef.current,
                    currentTarget: inputRef.current,
                } as React.ChangeEvent<HTMLInputElement>;
                props.onChange(syntheticEvent);
            }
        }
    };

    const handleDecrement = () => {
        if (inputRef.current) {
            inputRef.current.stepDown();
            const event = new Event('change', { bubbles: true });
            inputRef.current.dispatchEvent(event);
            if (props.onChange) {
                const syntheticEvent = {
                    target: inputRef.current,
                    currentTarget: inputRef.current,
                } as React.ChangeEvent<HTMLInputElement>;
                props.onChange(syntheticEvent);
            }
        }
    };

    return (
        <div className={cn("space-y-2", isMinimal && "space-y-1", className)}>
            {label && (
                <RadixLabel.Root
                    className={cn(
                        "font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none cursor-pointer",
                        isMinimal ? "text-[8px]" : "text-[10px]"
                    )}
                    htmlFor={id}
                >
                    {label}
                    {props.required && <span className="text-accent-primary leading-none">*</span>}
                    {labelAccessory}
                </RadixLabel.Root>
            )}

            <div className="relative group flex items-center">
                <input
                    {...props}
                    id={id}
                    ref={inputRef}
                    type="number"
                    className={cn(
                        "w-full bg-white/5 border border-white/10 rounded-xl text-content-primary focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/30 disabled:opacity-40 disabled:cursor-not-allowed",
                        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                        isMinimal ? "h-8 px-2 text-xs rounded-lg" : "h-11 px-4 text-sm",
                        suffix ? (isMinimal ? "pr-10" : "pr-16") : (hideArrows ? "pr-4" : (isMinimal ? "pr-8" : "pr-10")),
                        error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10",
                        inputClassName
                    )}
                />

                <div className={cn("absolute flex items-center pr-2 pointer-events-none", isMinimal ? "right-6" : "right-10")}>
                    {suffix && (
                        <span className={cn(
                            "font-black text-content-tertiary uppercase tracking-widest opacity-40",
                            isMinimal ? "text-[7px]" : "text-[10px]"
                        )}>
                            {suffix}
                        </span>
                    )}
                </div>

                {!hideArrows && (
                    <div className={cn("absolute flex flex-col gap-0.5 pointer-events-none", isMinimal ? "right-1.5" : "right-2.5")}>
                        <button
                            type="button"
                            onClick={handleIncrement}
                            disabled={props.disabled}
                            className="p-0.5 text-content-tertiary hover:text-content-primary transition-all disabled:opacity-20 pointer-events-auto active:scale-90"
                        >
                            <ChevronUp className={isMinimal ? "w-2.5 h-2.5" : "w-3.5 h-3.5"} />
                        </button>
                        <button
                            type="button"
                            onClick={handleDecrement}
                            disabled={props.disabled}
                            className="p-0.5 text-content-tertiary hover:text-content-primary transition-all disabled:opacity-20 pointer-events-auto active:scale-90"
                        >
                            <ChevronDown className={isMinimal ? "w-2.5 h-2.5" : "w-3.5 h-3.5"} />
                        </button>
                    </div>
                )}
            </div>

            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
