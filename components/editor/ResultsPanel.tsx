'use client';

import React from 'react';
import { ChevronDown, ChevronUp, X, Loader2 } from 'lucide-react';
import MessageRenderer from '../chat/MessageRenderer';

interface ResultsPanelProps {
    result: any;
    isExecuting: boolean;
    error?: string | null;
    onClose: () => void;
}

export default function ResultsPanel({ result, isExecuting, error, onClose }: ResultsPanelProps) {
    const [isExpanded, setIsExpanded] = React.useState(true);

    if (!result && !isExecuting && !error) {
        return null;
    }

    return (
        <div className="border-t border-gray-200 bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    <span>Execution Results</span>
                </button>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Close results"
                >
                    <X className="w-4 h-4 text-gray-500" />
                </button>
            </div>

            {/* Content */}
            {isExpanded && (
                <div className="p-4 max-h-96 overflow-y-auto">
                    {isExecuting ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="text-center space-y-3">
                                <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto" />
                                <p className="text-gray-600">Executing workflow...</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 mt-0.5">
                                    <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-sm font-medium text-red-800">Execution Failed</h3>
                                    <p className="text-sm text-red-700 mt-1">{error}</p>
                                </div>
                            </div>
                        </div>
                    ) : result ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <span className="font-medium text-green-800">Execution Successful</span>
                            </div>
                            <MessageRenderer data={result} />
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}
