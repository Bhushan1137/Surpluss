'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  dangerous?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
  dangerous = false,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
        onClick={loading ? undefined : onCancel}
      />
      <div className="relative bg-white rounded-lg border border-slate-200 shadow-xl p-6 max-w-md w-full">
        <h3
          id="confirm-dialog-title"
          className="text-base font-semibold text-slate-900 mb-2"
        >
          {title}
        </h3>
        <p id="confirm-dialog-desc" className="text-sm text-slate-600 mb-6 leading-relaxed">
          {description}
        </p>
        <div className="flex gap-2.5 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white rounded-md disabled:opacity-60 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              dangerous
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                : 'bg-slate-900 hover:bg-slate-800 focus:ring-slate-700'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
