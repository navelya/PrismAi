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
}

export function NumberInput({ label, error, suffix, className, inputClassName, hideArrows = false, ...props }: NumberInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const defaultId = useId();
    const id = props.id || defaultId;

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
        <div className={cn("space-y-2", className)}>
            {label && (
                <RadixLabel.Root
                    className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none cursor-pointer"
                    htmlFor={id}
                >
                    {label}
                    {props.required && <span className="text-accent-primary leading-none">*</span>}
                </RadixLabel.Root>
            )}

            <div className="relative group flex items-center">
                <input
                    {...props}
                    id={id}
                    ref={inputRef}
                    type="number"
                    className={cn(
                        "w-full h-11 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-content-primary text-sm focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/30 disabled:opacity-40 disabled:cursor-not-allowed",
                        "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                        suffix ? "pr-16" : (hideArrows ? "pr-4" : "pr-10"),
                        error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10",
                        inputClassName
                    )}
                />

                <div className="absolute right-10 flex items-center pr-2 pointer-events-none">
                    {suffix && (
                        <span className="text-[10px] font-black text-content-tertiary uppercase tracking-widest opacity-40">
                            {suffix}
                        </span>
                    )}
                </div>

                {!hideArrows && (
                    <div className="absolute right-2.5 flex flex-col gap-0.5 pointer-events-none">
                        <button
                            type="button"
                            onClick={handleIncrement}
                            disabled={props.disabled}
                            className="p-0.5 text-content-tertiary hover:text-content-primary transition-all disabled:opacity-20 pointer-events-auto active:scale-90"
                        >
                            <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleDecrement}
                            disabled={props.disabled}
                            className="p-0.5 text-content-tertiary hover:text-content-primary transition-all disabled:opacity-20 pointer-events-auto active:scale-90"
                        >
                            <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
