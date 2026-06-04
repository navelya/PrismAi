'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';

export interface ClarificationQuestionUI {
    question: string;
    options: string[];
}

interface Ans {
    chosenIndex: number | null;
    text: string;
}

interface Props {
    questions: ClarificationQuestionUI[];
    /** Set once the user has finished answering (or on a persisted/reloaded turn). */
    answer?: { text: string; chosenIndex?: number | null; answers?: Ans[] };
    /** Called ONCE, after the last question is answered, with the combined reply. */
    onComplete: (payload: { text: string; answers: Ans[] }) => void;
}

/**
 * Inline clarification card. Presents 1-N questions ONE AT A TIME in a single
 * slider: answering a question slides to the next; a counter with ‹ › arrows
 * lets the user step back to review/change. When every question is answered the
 * combined reply is submitted as one user turn and this card vanishes — the
 * user's answer bubble becomes the record.
 */
export function ClarificationCard({ questions, answer, onComplete }: Props) {
    const total = questions.length;
    const [answers, setAnswers] = useState<(Ans | undefined)[]>(() => questions.map(() => undefined));
    const [current, setCurrent] = useState(0);
    const [draft, setDraft] = useState('');
    // Slide direction for the enter animation (1 = forward, -1 = back).
    const [dir, setDir] = useState(1);
    const completedRef = useRef(false);

    // When the visible question changes, seed the write-your-own with its typed
    // answer (if it was answered by typing) so navigating back is editable.
    useEffect(() => {
        const a = answers[current];
        setDraft(a && a.chosenIndex === null ? a.text : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current]);

    // Once submitted/persisted, the card disappears — the answer bubble is the record.
    if (answer) return null;

    const q = questions[current];
    if (!q) return null;
    const currentAns = answers[current];

    const buildCombinedText = (all: Ans[]): string => {
        if (total <= 1) return all[0]?.text ?? '';
        return questions
            .map((qq, i) => (qq.question ? `${qq.question} → ${all[i]?.text ?? ''}` : all[i]?.text ?? ''))
            .join('\n');
    };

    const recordAnswer = (ans: Ans) => {
        if (completedRef.current) return;
        const next = answers.slice();
        next[current] = ans;
        setAnswers(next);
        setDraft('');

        if (next.every((a) => a !== undefined)) {
            completedRef.current = true;
            onComplete({ text: buildCombinedText(next as Ans[]), answers: next as Ans[] });
            return;
        }
        // Advance to the next still-unanswered question (wrapping around).
        for (let k = 1; k <= total; k++) {
            const idx = (current + k) % total;
            if (next[idx] === undefined) {
                setDir(idx >= current ? 1 : -1);
                setCurrent(idx);
                break;
            }
        }
    };

    const goPrev = () => {
        if (current > 0) {
            setDir(-1);
            setCurrent(current - 1);
        }
    };
    const goNext = () => {
        if (current < total - 1) {
            setDir(1);
            setCurrent(current + 1);
        }
    };

    const submitTyped = () => {
        const trimmed = draft.trim();
        if (trimmed.length === 0) return;
        recordAnswer({ chosenIndex: null, text: trimmed });
    };

    const typedActive = !!currentAns && currentAns.chosenIndex === null;

    return (
        <div className="mt-3 rounded-xl border border-stroke-subtle bg-surface-secondary/40 p-2.5 animate-fade-in">
            {/* header: question text + (when multiple) counter with nav arrows */}
            <div className="mb-2 flex items-start gap-2 px-1">
                {q.question.length > 0 && (
                    <span className="flex-1 text-[13px] leading-snug text-content-primary">{q.question}</span>
                )}
                {total > 1 && (
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 pt-0.5">
                        <button
                            type="button"
                            onClick={goPrev}
                            disabled={current === 0}
                            aria-label="Previous question"
                            className="rounded p-0.5 text-content-tertiary transition-colors enabled:hover:text-content-primary disabled:opacity-30"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-[34px] text-center text-[10px] tabular-nums text-content-tertiary">
                            {current + 1} / {total}
                        </span>
                        <button
                            type="button"
                            onClick={goNext}
                            disabled={current === total - 1}
                            aria-label="Next question"
                            className="rounded p-0.5 text-content-tertiary transition-colors enabled:hover:text-content-primary disabled:opacity-30"
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* the single active question, re-keyed so it slides on change */}
            <div key={current} className={dir >= 0 ? 'clar-slide-next space-y-1.5' : 'clar-slide-prev space-y-1.5'}>
                {q.options.map((opt, i) => {
                    const isChosen = currentAns?.chosenIndex === i;
                    return (
                        <button
                            key={i}
                            type="button"
                            onClick={() => recordAnswer({ chosenIndex: i, text: opt })}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-all
                                ${isChosen
                                    ? 'border-accent-primary/40 bg-accent-primary/15 text-content-primary font-medium'
                                    : 'cursor-pointer border-stroke-subtle bg-surface-tertiary/60 text-content-primary hover:border-accent-primary/30 hover:bg-accent-primary/10'}`}
                        >
                            <span className="flex items-center justify-between gap-2">
                                <span>{opt}</span>
                                {isChosen && <Check className="h-4 w-4 flex-shrink-0 text-accent-primary" />}
                            </span>
                        </button>
                    );
                })}

                {/* write-your-own */}
                <div
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all
                        ${typedActive
                            ? 'border-accent-primary/40 bg-accent-primary/15 text-content-primary font-medium'
                            : 'border-stroke-subtle bg-surface-tertiary/60 hover:border-accent-primary/30 focus-within:border-accent-primary/50'}`}
                >
                    <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                submitTyped();
                            }
                        }}
                        placeholder="Something else…"
                        className="flex-1 bg-transparent text-sm placeholder-content-tertiary focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={submitTyped}
                        disabled={draft.trim().length === 0}
                        aria-label="Submit answer"
                        aria-hidden={draft.trim().length === 0}
                        className={`flex-shrink-0 rounded-md p-1 text-accent-primary transition-colors ${
                            draft.trim().length > 0 ? 'hover:bg-accent-primary/10' : 'invisible pointer-events-none'
                        }`}
                    >
                        <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => recordAnswer({ chosenIndex: null, text: 'Skip' })}
                        className="flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-content-tertiary transition-colors hover:bg-surface-tertiary/80 hover:text-content-primary"
                    >
                        Skip
                    </button>
                </div>
            </div>
        </div>
    );
}
