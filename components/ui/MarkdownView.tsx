'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';

// Theme-matched renderers so template "How it works" content looks consistent
// wherever it's shown (editor preview + the template detail view).
const components = {
  h1: (p: any) => <h2 className="text-base font-bold text-content-primary mt-3 mb-1.5" {...p} />,
  h2: (p: any) => <h3 className="text-sm font-bold text-content-primary mt-3 mb-1.5" {...p} />,
  h3: (p: any) => <h4 className="text-sm font-semibold text-content-primary mt-2 mb-1" {...p} />,
  p: (p: any) => <p className="mb-2 leading-relaxed" {...p} />,
  ul: (p: any) => <ul className="list-disc list-inside mb-2 space-y-1" {...p} />,
  ol: (p: any) => <ol className="list-decimal list-inside mb-2 space-y-1" {...p} />,
  li: (p: any) => <li className="leading-relaxed" {...p} />,
  a: (p: any) => <a className="text-accent-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-content-primary" {...p} />,
  em: (p: any) => <em className="italic" {...p} />,
  code: (p: any) => <code className="px-1 py-0.5 rounded bg-white/10 text-[12px]" {...p} />,
  blockquote: (p: any) => <blockquote className="border-l-2 border-stroke-subtle pl-3 text-content-tertiary italic my-2" {...p} />,
};

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`text-content-secondary text-sm ${className ?? ''}`}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
