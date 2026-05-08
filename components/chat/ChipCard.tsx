'use client';

import React, { useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';

interface ChipCardProps {
    /** Chip labels from message.clarification.options */
    options: string[];
    /**
     * Answered state. When set, the card renders disabled with the chosen
     * chip highlighted (chosenIndex >= 0) or the typed text shown in the
     * write-your-own slot (chosenIndex === null).
     */
    answer?: { chosenIndex: number | null; text: string };
    /** Called when the user picks a chip or submits the write-your-own input. */
    onAnswer: (payload: { chosenIndex: number | null; text: string }) => void;
}

/**
 * Inline chip card rendered inside the assistant message bubble for a
 * clarification turn. Shows N chip buttons + a write-your-own text-input chip.
 *
 * Pending state: chips clickable, input focusable.
 * Answered state: chips disabled, chosen one filled with accent + checkmark.
 *                 Or, if answered by typing, the input shows the typed text.
 */
export function ChipCard({ options, answer, onAnswer }: ChipCardProps) {
    const [draft, setDraft] = useState('');
    const isAnswered = !!answer;

    const handleChipClick = (index: number) => {
        if (isAnswered) return;
        onAnswer({ chosenIndex: index, text: options[index] });
    };

    const handleSubmitTyped = () => {
        const trimmed = draft.trim();
        if (isAnswered || trimmed.length === 0) return;
        onAnswer({ chosenIndex: null, text: trimmed });
    };

    const handleSkip = () => {
        if (isAnswered) return;
        onAnswer({ chosenIndex: null, text: 'Skip' });
    };

    const typedDisplay = isAnswered && answer?.chosenIndex === null ? answer.text : draft;
    const typedFilled = isAnswered && answer?.chosenIndex === null;

    return (
        <div className="mt-3 rounded-xl border border-stroke-subtle bg-surface-secondary/40 p-2.5 space-y-1.5 animate-fade-in">
            {options.map((opt, i) => {
                const isChosen = isAnswered && answer?.chosenIndex === i;
                const isDimmed = isAnswered && !isChosen;
                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => handleChipClick(i)}
                        disabled={isAnswered}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all border
                            ${isChosen
                                ? 'bg-accent-primary/15 border-accent-primary/40 text-content-primary font-medium'
                                : isDimmed
                                    ? 'bg-surface-tertiary/30 border-stroke-subtle/50 text-content-tertiary opacity-50 cursor-not-allowed'
                                    : 'bg-surface-tertiary/60 border-stroke-subtle text-content-primary hover:bg-accent-primary/10 hover:border-accent-primary/30 cursor-pointer'}`}
                    >
                        <span className="flex items-center justify-between gap-2">
                            <span>{opt}</span>
                            {isChosen && <Check className="w-4 h-4 text-accent-primary flex-shrink-0" />}
                        </span>
                    </button>
                );
            })}

            {/* Write-your-own input chip */}
            <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all
                    ${typedFilled
                        ? 'bg-accent-primary/15 border-accent-primary/40 text-content-primary font-medium'
                        : isAnswered
                            ? 'bg-surface-tertiary/30 border-stroke-subtle/50 opacity-50'
                            : 'bg-surface-tertiary/60 border-stroke-subtle hover:border-accent-primary/30 focus-within:border-accent-primary/50'}`}
            >
                <input
                    type="text"
                    value={typedDisplay}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSubmitTyped();
                        }
                    }}
                    placeholder="Something else…"
                    disabled={isAnswered}
                    className="flex-1 bg-transparent focus:outline-none text-sm placeholder-content-tertiary disabled:cursor-not-allowed"
                />
                {!isAnswered && (
                    <>
                        {/* Arrow always rendered to reserve layout space — invisible until there's draft text */}
                        <button
                            type="button"
                            onClick={handleSubmitTyped}
                            disabled={draft.trim().length === 0}
                            aria-label="Submit answer"
                            aria-hidden={draft.trim().length === 0}
                            className={`flex-shrink-0 p-1 rounded-md text-accent-primary transition-colors ${
                                draft.trim().length > 0
                                    ? 'hover:bg-accent-primary/10'
                                    : 'invisible pointer-events-none'
                            }`}
                        >
                            <ArrowRight className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={handleSkip}
                            className="flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-medium text-content-tertiary hover:text-content-primary hover:bg-surface-tertiary/80 transition-colors"
                        >
                            Skip
                        </button>
                    </>
                )}
                {typedFilled && <Check className="w-4 h-4 text-accent-primary flex-shrink-0" />}
            </div>
        </div>
    );
}
