import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ProtocolBanner({ protocol, onOpen }) {
  if (!protocol?.active) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full border-b border-red-700/40 bg-red-600 text-white text-left transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
      aria-label="Ver detalle del protocolo activo"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold uppercase leading-tight tracking-tight">
            {protocol.title || 'PROTOCOLO ACTIVADO'}
          </p>
          {protocol.subtitle ? (
            <p className="truncate text-xs font-medium text-white/90">{protocol.subtitle}</p>
          ) : null}
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-white/85 sm:inline-flex">
          <Info className="h-3.5 w-3.5" />
          Ver detalle
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
        <div className="bg-orange-600 px-5 py-4 text-white sm:px-6">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold uppercase tracking-tight text-white sm:text-xl">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {protocol.title || 'PROTOCOLO ACTIVADO'}
            </DialogTitle>
            <DialogDescription className="text-sm font-medium text-white/90">
              {protocol.subtitle || 'Información operativa del protocolo'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-0 md:grid-cols-2">
          <section className="border-b border-border p-5 sm:p-6 md:border-b-0 md:border-r">
            <h3 className="mb-3 text-sm font-bold uppercase text-orange-700 dark:text-orange-400">
              Restricciones
            </h3>
            <ul className="space-y-3">
              {restrictions.map((item, idx) => (
                <li key={idx} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-600" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
              {restrictions.length === 0 && (
                <li className="text-sm text-muted-foreground">Sin restricciones configuradas.</li>
              )}
            </ul>
          </section>

          <section className="bg-muted/30 p-5 sm:p-6">
            <h3 className="mb-3 text-sm font-bold uppercase text-orange-700 dark:text-orange-400">
              Información
            </h3>
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {protocol.info_text || 'Sin información adicional.'}
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
