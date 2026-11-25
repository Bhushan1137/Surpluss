'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface JsonViewerProps {
  data: unknown;
  title?: string;
}

export function JsonViewer({ data, title }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const formatted = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be unavailable in insecure contexts
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-950">
      <div className="flex items-center justify-between bg-slate-900 px-3.5 py-2 border-b border-slate-800">
        <span className="text-xs font-medium text-slate-300">
          {title ?? 'JSON Payload'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Copy JSON payload"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 text-xs text-slate-100 overflow-x-auto font-mono leading-relaxed max-h-80">
        {formatted}
      </pre>
    </div>
  );
}
