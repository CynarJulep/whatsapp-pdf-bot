import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ProtocolBanner({ protocol, onOpen }) {
  if (!protocol?.active) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full border-b-2 border-red-900 bg-red-700 text-left text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
      aria-label="Ver detalle del protocolo activo"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-3.5">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/15 sm:h-14 sm:w-14"
          aria-hidden
        >
          <AlertTriangle className="h-7 w-7 text-white sm:h-8 sm:w-8" strokeWidth={2.5} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase text-white/90 sm:text-xs">
            Atención
          </p>
          <p className="text-sm font-black uppercase leading-tight tracking-tight sm:text-base">
            {protocol.title || 'PROTOCOLO ACTIVADO'}
          </p>
          {protocol.subtitle ? (
            <p className="mt-0.5 truncate text-xs font-medium text-white/90 sm:text-sm">
              {protocol.subtitle}
            </p>
          ) : null}
        </div>

        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-white/90 sm:gap-1">
          <span className="hidden sm:inline">Ver detalle</span>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </span>
      </div>
    </button>
  );
}

export function ProtocolInfoDialog({ open, onOpenChange, protocol }) {
  if (!protocol) return null;

  const restrictions = Array.isArray(protocol.restrictions) ? protocol.restrictions : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="bg-red-700 px-5 py-5 text-white sm:px-6">
          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/15">
                <AlertTriangle className="h-7 w-7" strokeWidth={2.5} />
              </span>
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-bold uppercase text-white/90">Atención</p>
                <DialogTitle className="text-lg font-black uppercase tracking-tight text-white sm:text-xl">
                  {protocol.title || 'PROTOCOLO ACTIVADO'}
                </DialogTitle>
                <DialogDescription className="text-sm font-medium text-white/90">
                  {protocol.subtitle || 'Información operativa del protocolo'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="grid gap-0 md:grid-cols-2">
          <section className="border-b border-border p-5 sm:p-6 md:border-b-0 md:border-r">
            <h3 className="mb-3 text-sm font-bold uppercase text-red-700 dark:text-red-400">
              Restricciones
            </h3>
            <ul className="space-y-3">
              {restrictions.map((item, idx) => (
                <li key={idx} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
              {restrictions.length === 0 && (
                <li className="text-sm text-muted-foreground">Sin restricciones configuradas.</li>
              )}
            </ul>
          </section>

          <section className="bg-muted/30 p-5 sm:p-6">
            <h3 className="mb-3 text-sm font-bold uppercase text-red-700 dark:text-red-400">
              Información
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {protocol.info_text || 'Sin información adicional.'}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
