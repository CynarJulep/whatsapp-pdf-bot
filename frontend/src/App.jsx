import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';
import {
  UploadCloud, FileText, Send, Users, Settings, CheckCircle,
  AlertCircle, RefreshCw, X, Trash2, Edit, Save, UserPlus,
  Search, Moon, Sun, Wifi, WifiOff, ChevronLeft,
  Check, Plus, Loader2, Zap, MapPin, ArrowRight,
  History, Clock, ChevronDown, ChevronUp, HelpCircle, BookOpen,
  Copy
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import SubtypesCatalogDialog from '@/components/SubtypesCatalogDialog';

// ── PDF.js worker ──────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// ── PDF Canvas Viewer ──────────────────────────────────────────────────────────
// Renders a PDF File object directly to <canvas> elements using PDF.js.
// This avoids blob: URLs which are blocked by Chrome when the page is
// embedded inside a Google Sites iframe.
function PdfCanvasViewer({ file }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const container = containerRef.current;

    async function render() {
      setLoading(true);
      setError(null);
      // Clear previous canvases
      if (container) container.innerHTML = '';
      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page-canvas';
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          if (i < pdf.numPages) {
            canvas.style.borderBottom = '1px solid var(--border)';
          }
          if (container) container.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Error al renderizar el PDF');
          setLoading(false);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [file]);

  return (
    <div className="w-full pdf-viewer-container px-4 pb-5 pt-3">
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center justify-center gap-2 text-destructive text-xs px-4 py-12 text-center">
          <AlertCircle className="w-6 h-6" />
          <span>{error}</span>
        </div>
      )}
      <div
        ref={containerRef}
        className={`pdf-document-sheet w-full flex flex-col ${loading || error ? 'hidden' : ''}`}
      />
    </div>
  );
}

// ── Config ─────────────────────────────────────────────────────────────────────
const DEFAULT_SUPABASE_URL = 'https://hltyozdvcqfmvqmyrlva.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdHlvemR2Y3FmbXZxbXlybHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjE5OTEsImV4cCI6MjA5NTYzNzk5MX0.bidc0Iq1-2ztsa6oazqrkt4DJ5b4rBSnIC1PM1E733U';
const DEFAULT_BACKEND_URL = 'https://whatsapp-pdf-bot-backend.onrender.com';
const MAX_RECIPIENTS = 3;

const getParam = (param, def) => {
  const url = new URLSearchParams(window.location.search);
  if (url.has(param)) { localStorage.setItem(param.toUpperCase(), url.get(param)); return url.get(param); }
  return localStorage.getItem(param.toUpperCase()) || def;
};

// In dev mode (no railway_url param configured), use '/api' so Vite's
// proxy rewrites requests to localhost:3000 automatically.
// In production, the full Render URL is used via the railway_url param.
const supabaseUrl = getParam('supabase_url', DEFAULT_SUPABASE_URL);
const supabaseKey = getParam('supabase_anon_key', DEFAULT_SUPABASE_ANON_KEY);
const _configuredBackendUrl = getParam('railway_url', null);
const backendUrl  = _configuredBackendUrl || '/api';
const supabase    = createClient(supabaseUrl, supabaseKey);

// ── Helpers ────────────────────────────────────────────────────────────────────
const initials = (name = '') => name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
const formatBytes = (b) => b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(2)} MB`;
const normalizePhone = (raw) => {
  let p = raw.replace(/\D/g, '');
  if (p.length === 10 && /^[123]/.test(p)) p = '549' + p;
  else if (p.length === 12 && p.startsWith('54') && p[2] !== '9') p = '549' + p.slice(2);
  return p;
};

// ── Extract PDF text and detect "Area destino" ─────────────────────────────────
async function extractPdfInfo(file) {
  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(it => it.str).join(' ') + '\n';
    }

    // Try to find "Area destino" value
    const areaMatch = fullText.match(/[Áá]rea\s+destino\s*[:\-]?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑA-Za-záéíóúüñ\s]{2,40}?)(?=(?:\s{2,}|\n|Fecha|Estado|Ubicaci|$))/i);
    const areaDestino = areaMatch ? areaMatch[1].trim() : null;

    // Also try to get solicitud number
    const solicitudMatch = fullText.match(/Solicitud\s+Nro[:\s.]*([0-9\-]+)/i);
    const solicitudNro = solicitudMatch ? solicitudMatch[1].trim() : null;

    // Tipo
    const tipoMatch = fullText.match(/Tipo[:\s\-]+([\s\S]+?)(?=(?:Subtipo|Descripci[oó]n|Fecha|Ubicaci[oó]n|Estado|Usuario|Prioridad|Origen)[:\-]\s+|$)/i);
    const tipo = tipoMatch ? tipoMatch[1].trim() : null;

    // Subtipo
    const subtipoMatch = fullText.match(/Subtipo[:\s\-]+([\s\S]+?)(?=(?:Descripci[oó]n|Fecha|Ubicaci[oó]n|Estado|Usuario|Prioridad|Origen|Solicitud|Tipo)[:\-]\s+|$)/i);
    const subtipo = subtipoMatch ? subtipoMatch[1].trim() : null;

    // Ubicación
    const ubicacionMatch = fullText.match(/Ubicaci[oó]n[:\s\-]+([\s\S]+?)(?=(?:Distrito|Vecinal|Descripci[oó]n|Fecha|Estado|Usuario|Prioridad|Origen|Solicitud|Tipo|Subtipo)[:\-]\s+|$)/i);
    const ubicacion = ubicacionMatch ? ubicacionMatch[1].trim() : null;

    // Descripción
    const descripcionMatch = fullText.match(/Descripci[oó]n[:\s\-]+([\s\S]+?)(?=(?:Fecha|Ubicaci[oó]n|Estado|Usuario|Prioridad|Origen|Solicitud|Tipo|Subtipo)[:\-]\s+|$)/i);
    const descripcion = descripcionMatch ? descripcionMatch[1].trim() : null;

    // Fecha
    const fechaMatch = fullText.match(/Fecha[:\s\-]+([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s+[0-9]{2}:[0-9]{2})/i);
    const fecha = fechaMatch ? fechaMatch[1].trim() : null;

    return { areaDestino, solicitudNro, tipo, subtipo, ubicacion, descripcion, fecha, fullText };
  } catch {
    return { areaDestino: null, solicitudNro: null, tipo: null, subtipo: null, ubicacion: null, descripcion: null, fecha: null, fullText: '' };
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border animate-fade-slide-up
      ${type === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300'
        : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-300'}`}>
      {type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-1 opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ── Step Indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current, labels }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {labels.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-1.5">
            <div className={`step-dot w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-400
              ${i < current ? 'bg-primary text-primary-foreground' :
                i === current ? 'bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110' :
                'bg-muted text-muted-foreground'}`}>
              {i < current ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap
              ${i === current ? 'text-primary' : 'text-muted-foreground'}`}>
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div className={`h-px w-12 mb-5 transition-all duration-500 ${i < current ? 'bg-primary' : 'bg-border'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Step 0: Drop Zone ──────────────────────────────────────────────────────────
function DropZone({ onFile, botStatus, onOpenConfig }) {
  const [active, setActive] = useState(false);
  const inputRef = useRef(null);

  const { connected, connecting, checking, qr, offline } = botStatus;
  const isInteractable = connected;

  const handleDrag = (e) => {
    if (!isInteractable) return;
    e.preventDefault(); e.stopPropagation();
    setActive(e.type === 'dragenter' || e.type === 'dragover');
  };
  const validate = (file) => {
    if (!isInteractable) return;
    if (file.type !== 'application/pdf') return;
    if (file.size > 52428800) return;
    onFile(file);
  };

  // Determine status visual elements
  let content;
  if (checking || offline) {
    content = {
      icon: <RefreshCw className="w-10 h-10 text-primary animate-spin" />,
      title: "Despertando servidor...",
      description: "El bot está inactivo en la nube. Lo estamos despertando, por favor aguardá un momento...",
      className: "border-muted bg-muted/20 opacity-75 cursor-wait"
    };
  } else if (!connected && connecting && !qr) {
    content = {
      icon: <Loader2 className="w-10 h-10 text-primary animate-spin" />,
      title: "Iniciando sesión de WhatsApp...",
      description: "Recuperando credenciales y conectando. No es necesario escanear el QR, aguardá unos segundos.",
      className: "border-primary/30 bg-primary/[0.02] cursor-wait animate-pulse"
    };
  } else if (!connected) {
    content = {
      icon: <WifiOff className="w-10 h-10 text-red-500 animate-pulse" />,
      title: "WhatsApp Desconectado",
      description: "Para poder enviar reclamos primero debés vincular la sesión de WhatsApp del teléfono de PAI.",
      className: "border-red-200 bg-red-500/[0.02] opacity-70 hover:border-red-300",
      showButton: true
    };
  } else {
    content = {
      icon: <UploadCloud className="w-10 h-10 text-primary" />,
      title: active ? 'Soltá para cargar' : 'Arrastrá acá para enviar por PAI el reclamo...',
      description: "o tocá para buscar en tus archivos",
      className: active 
        ? 'dropzone-active border-primary bg-primary/5 scale-[1.01]' 
        : 'border-border hover:border-primary/50 hover:bg-muted/40'
    };
  }

  return (
    <div className="animate-fade-slide-up flex flex-col items-center w-full">
      <div
        onDragEnter={handleDrag} onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={(e) => { 
          e.preventDefault(); e.stopPropagation(); 
          if (!isInteractable) return;
          setActive(false); 
          const f = e.dataTransfer.files?.[0]; 
          if (f) validate(f); 
        }}
        onClick={() => {
          if (isInteractable) {
            inputRef.current?.click();
          } else if (!checking && !connecting && !connected) {
            onOpenConfig();
          }
        }}
        className={`dropzone-idle w-full max-w-4xl border-2 border-dashed rounded-3xl cursor-pointer
          flex flex-col items-center justify-center gap-6 py-16 px-8
          transition-all duration-300 select-none relative overflow-hidden
          ${content.className}`}
      >
        {isInteractable && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none z-0">
            <div className="absolute w-[125%] aspect-square rounded-full bg-primary/[0.04] border border-primary/25 animate-radar-1" />
            <div className="absolute w-[125%] aspect-square rounded-full bg-primary/[0.04] border border-primary/25 animate-radar-2" />
            <div className="absolute w-[125%] aspect-square rounded-full bg-primary/[0.04] border border-primary/25 animate-radar-3" />
          </div>
        )}
        <input 
          ref={inputRef} 
          type="file" 
          accept="application/pdf" 
          className="hidden"
          disabled={!isInteractable}
          onChange={(e) => e.target.files?.[0] && validate(e.target.files[0])} 
        />
        <div className={`relative z-10 transition-all duration-300
          ${isInteractable ? 'animate-float text-primary' : 'text-muted-foreground'}
          ${!isInteractable && !checking && !connecting ? 'text-red-500 scale-105' : ''}
          ${active ? 'scale-115 text-primary' : ''}`}
        >
          {React.cloneElement(content.icon, { className: "w-16 h-16 transition-all duration-300" })}
        </div>
        <div className="text-center space-y-2 relative z-10">
          <p className={`text-xl sm:text-2xl font-bold ${
            !isInteractable && !checking && !connecting ? 'text-red-600 dark:text-red-400 font-black' : 'text-foreground'
          }`}>
            {content.title}
          </p>
          <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto">
            {content.description}
          </p>
          {content.showButton && (
            <div className="pt-4">
              <Button 
                onClick={(e) => { e.stopPropagation(); onOpenConfig(); }}
                className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-2.5 rounded-xl shadow-md gap-2"
              >
                Vincular WhatsApp <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
          {isInteractable && (
            <p className="text-xs text-muted-foreground/50 pt-2">Solo PDF · Máximo 50 MB</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Preview + Contact Picker (split layout) ────────────────────────────
function PreviewAndPick({ file, contacts, groups = [], subtypesCatalog, onAddSubtipoToCatalog, onBack, onSend, sending, progress, progressText, onDerivationChange, onCatalogSearch, showToast }) {
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [extracting, setExtracting] = useState(true);
  const [pdfInfo, setPdfInfo] = useState({ areaDestino: null, solicitudNro: null, tipo: null, subtipo: null, ubicacion: null, descripcion: null, fecha: null });
  const [messageText, setMessageText] = useState('');
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const derivationBannerRef = useRef(null);

  const scrollToDerivationBanner = useCallback(() => {
    const scroll = () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      derivationBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    requestAnimationFrame(() => {
      scroll();
      setTimeout(scroll, 120);
    });
  }, []);

  const activeContacts = contacts.filter(c => c.is_active);
  const activeGroups = groups.filter(g => g.is_active);

  const mergedRecipients = useMemo(() => {
    return [
      ...activeContacts.map(c => ({ ...c, isGroup: false, recipientKey: `c_${c.id}` })),
      ...activeGroups.map(g => ({ ...g, isGroup: true, recipientKey: `g_${g.id}` }))
    ];
  }, [activeContacts, activeGroups]);

  // Extract PDF info and auto-select matching contact / group
  useEffect(() => {
    setExtracting(true);
    extractPdfInfo(file).then((info) => {
      setPdfInfo(info);
      setExtracting(false);

      const isNonSac = !info.solicitudNro && !info.subtipo && !info.ubicacion && !info.areaDestino;

      let defaultMsg = '';
      if (isNonSac) {
        defaultMsg = "Atención Ciudadana le hace llegar el documento adjunto.";
      } else {
        defaultMsg = `Atención Ciudadana le hace llegar el siguiente reclamo:
*Solicitud Nro:* ${info.solicitudNro || 'No especificado'}

*Subtipo:* ${info.subtipo || 'No especificado'}

*Ubicación:* ${info.ubicacion || 'No especificada'}

*Descripción:* ${info.descripcion || 'No especificado'}

Este reclamo fue cargado en el SAC el ${info.fecha || 'No especificada'}`;
      }
      setMessageText(defaultMsg);

      // Strict Preselection
      const newSelected = new Set();
      if (info.subtipo && subtypesCatalog && subtypesCatalog.length > 0) {
        const cleanSub = info.subtipo.trim().toLowerCase();
        const matchedItem = subtypesCatalog.find(
          item => item.subtipo.trim().toLowerCase() === cleanSub
        );
        if (matchedItem && matchedItem.derivar) {
          // Preselect contact
          const match = activeContacts.find(c => 
            c.subtypes && c.subtypes.some(s => s.trim().toLowerCase() === cleanSub)
          );
          if (match) {
            newSelected.add(`c_${match.id}`);
          }
          // Preselect group
          const groupMatch = activeGroups.find(g =>
            g.subtypes && g.subtypes.some(s => s.trim().toLowerCase() === cleanSub)
          );
          if (groupMatch && newSelected.size < MAX_RECIPIENTS) {
            newSelected.add(`g_${groupMatch.id}`);
          }
        }
      }
      setSelected(newSelected);
    });
  }, [file, subtypesCatalog, contacts, groups]);

  useEffect(() => {
    if (!extracting) {
      const t = setTimeout(scrollToDerivationBanner, 80);
      return () => clearTimeout(t);
    }
  }, [extracting, scrollToDerivationBanner]);

  const matchedCatalogItem = useMemo(() => {
    if (!pdfInfo.subtipo || !subtypesCatalog || subtypesCatalog.length === 0) return null;
    const cleanSub = pdfInfo.subtipo.trim().toLowerCase();
    return subtypesCatalog.find(
      item => item.subtipo.trim().toLowerCase() === cleanSub
    );
  }, [pdfInfo.subtipo, subtypesCatalog]);

  // Propagate derivation status to the parent App component
  useEffect(() => {
    if (extracting) {
      if (onDerivationChange) onDerivationChange(null);
    } else {
      const isNonSac = !pdfInfo.solicitudNro && !pdfInfo.subtipo && !pdfInfo.ubicacion && !pdfInfo.areaDestino;
      if (isNonSac) {
        if (onDerivationChange) onDerivationChange('no-sac');
      } else if (matchedCatalogItem) {
        if (onDerivationChange) onDerivationChange(matchedCatalogItem.derivar ? 'derivar' : 'no-derivar');
      } else {
        if (onDerivationChange) onDerivationChange('no-catalogado');
      }
    }
  }, [matchedCatalogItem, pdfInfo, extracting, onDerivationChange]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (term === '') {
      return mergedRecipients;
    }
    return mergedRecipients.filter(r => 
      r.name.toLowerCase().includes(term) ||
      (r.description || '').toLowerCase().includes(term) ||
      (!r.isGroup && r.area_destino && r.area_destino.toLowerCase().includes(term)) ||
      (r.subtypes || []).some(s => s.toLowerCase().includes(term))
    );
  }, [mergedRecipients, search]);

  const toggle = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (next.size >= MAX_RECIPIENTS) return prev; // max 3
        next.add(key);
      }
      return next;
    });
  };

  const handleSend = () => {
    const selectedContacts = contacts.filter(c => selected.has(`c_${c.id}`));
    const selectedGroups = groups.filter(g => selected.has(`g_${g.id}`));
    const recipients = [
      ...selectedContacts.map(c => ({ ...c, isGroup: false })),
      ...selectedGroups.map(g => ({ ...g, isGroup: true }))
    ];
    onSend(recipients, pdfInfo, messageText);
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (sending) return;
      if (e.key === 'Enter' && selected.size > 0) {
        e.preventDefault();
        handleSend();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isOpen) {
          setIsOpen(false);
        } else {
          onBack();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, sending, onBack, isOpen]);

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(messageText).then(() => {
      if (showToast) {
        showToast("Mensaje copiado al portapapeles ✓");
      }
    }).catch(() => {
      if (showToast) {
        showToast("Error al copiar el mensaje", "error");
      }
    });
  };

  const selectedRecipients = mergedRecipients.filter(r => selected.has(r.recipientKey));

  return (
    <div className="animate-fade-slide-up w-full">
      {/* PDF info banner / PAI catalog matching */}
      <div ref={derivationBannerRef} className="flex flex-col gap-3 mb-6 scroll-mt-24">
        {extracting ? (
          <div className="flex items-center gap-3 text-base sm:text-lg text-muted-foreground py-8 bg-card border rounded-3xl justify-center shadow-inner animate-pulse">
            <Loader2 className="w-6 h-6 animate-spin text-primary shrink-0" />
            <span className="font-semibold">Analizando documento e identificando subtipos...</span>
          </div>
        ) : (
          (() => {
            const isNonSac = !pdfInfo.solicitudNro && !pdfInfo.subtipo && !pdfInfo.ubicacion && !pdfInfo.areaDestino;
            if (isNonSac) {
              return (
                <div className="py-5 px-6 sm:px-8 rounded-2xl text-center space-y-2 border border-amber-500/20 text-amber-950 dark:text-amber-300 bg-amber-500/[0.06] dark:bg-amber-950/20 msf-title-banner animate-fade-slide-up">
                  <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-tight text-amber-600 dark:text-amber-400 flex items-center justify-center gap-2 flex-wrap">
                    <AlertCircle className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
                    ARCHIVO NO ESPECÍFICO DEL SAC
                  </h2>
                  <p className="text-sm sm:text-base font-semibold text-muted-foreground/90 max-w-2xl mx-auto leading-relaxed">
                    Este documento no parece contener los campos habituales de un reclamo del SAC municipal. Se aplicará la plantilla general de envío.
                  </p>
                </div>
              );
            }
            return (
              <div className={`py-5 px-6 sm:px-8 rounded-2xl text-center space-y-2 border transition-all duration-300 msf-title-banner ${
                matchedCatalogItem
                  ? matchedCatalogItem.derivar
                    ? 'bg-emerald-500/[0.06] border-emerald-500/20 text-emerald-950 dark:text-emerald-300 dark:bg-emerald-950/20 dark:border-emerald-500/10'
                    : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-950 dark:text-rose-300 dark:bg-rose-950/20 dark:border-rose-500/10'
                  : 'bg-blue-500/[0.06] border-blue-500/20 text-blue-950 dark:text-blue-300 dark:bg-blue-950/20 dark:border-blue-500/10'
              }`}>
                <h2 className={`text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-tight ${
                  matchedCatalogItem
                    ? matchedCatalogItem.derivar
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                    : 'text-blue-600 dark:text-blue-400'
                }`}>
                  {matchedCatalogItem
                    ? matchedCatalogItem.derivar
                      ? 'ESTE RECLAMO SE DERIVA POR PAI'
                      : 'ESTE RECLAMO NO SE DERIVA POR PAI'
                    : 'SUBTIPO NO CATALOGADO'}
                </h2>
                <p className="text-sm sm:text-base md:text-lg font-semibold text-muted-foreground/90 max-w-2xl mx-auto leading-relaxed">
                  {matchedCatalogItem
                    ? matchedCatalogItem.derivar
                      ? `El subtipo ${matchedCatalogItem.subtipo} está configurado para derivación automática.`
                      : `El subtipo ${matchedCatalogItem.subtipo} no se debe derivar por este medio. Por favor, contactá a un supervisor.`
                    : `El subtipo ${pdfInfo.subtipo || "Desconocido"} no está registrado en el catálogo. Por favor, verificá con un supervisor.`}
                </p>
                {matchedCatalogItem && matchedCatalogItem.derivar && matchedCatalogItem.comentarios && (
                  <div className="mt-2 pt-2 border-t border-emerald-500/10 text-center max-w-3xl mx-auto">
                    <p className="text-sm sm:text-base font-bold leading-relaxed text-emerald-950 dark:text-emerald-200">
                      {matchedCatalogItem.comentarios}
                    </p>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* Dos columnas: PDF izquierda (ancho completo de columna) · envío derecha */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start preview-split-grid">

        <section className="min-w-0 preview-pdf-column">
          <div className="flex flex-col">
            <div className="flex items-center gap-2.5 px-1 py-2.5 border-b border-border/60">
              <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{file.name}</p>
                <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={onBack}
                className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded lg:hidden"
                title="Volver"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <PdfCanvasViewer file={file} />
          </div>
        </section>

        <section className="min-w-0 lg:sticky lg:top-20 self-start preview-send-panel">
        <div className="flex flex-col gap-4">
          
          {/* Header */}
          <div className="flex items-end justify-between border-b pb-2">
            <div className="space-y-1">
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground leading-none">
                ¿A quién enviás?
              </h3>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                Seleccioná hasta {MAX_RECIPIENTS} destinatarios
              </p>
            </div>
            {selected.size >= MAX_RECIPIENTS && (
              <Badge variant="destructive" className="text-xs font-bold shadow-sm">Límite alcanzado</Badge>
            )}
          </div>


          {/* Search Box & Floating Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Buscar destinatario por nombre, área o subtipo..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)} 
                onFocus={() => setIsOpen(true)}
                className="pl-10 h-10 text-sm" 
              />
            </div>

            {isOpen && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1.5 bg-popover border border-border shadow-2xl rounded-2xl max-h-[220px] overflow-y-auto animate-fade-slide-down">
                <div className="p-2 space-y-1">
                  {filtered.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-xs">
                      Sin destinatarios que coincidan
                    </div>
                  ) : filtered.map(r => {
                    const isSelected = selected.has(r.recipientKey);
                    const isAutoDetected = pdfInfo.subtipo &&
                      r.subtypes && r.subtypes.some(s => s.trim().toLowerCase() === pdfInfo.subtipo.trim().toLowerCase());
                    const isDisabled = !isSelected && selected.size >= MAX_RECIPIENTS;

                    return (
                      <div
                        key={r.recipientKey}
                        onClick={() => !isDisabled && toggle(r.recipientKey)}
                        className={`contact-card flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 text-xs
                          ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                          ${isSelected
                            ? 'bg-primary/10 border border-primary/25'
                            : isAutoDetected
                              ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                              : 'hover:bg-muted/60 border border-transparent'
                          }`}
                      >
                        <Checkbox checked={isSelected} disabled={isDisabled}
                          onCheckedChange={() => !isDisabled && toggle(r.recipientKey)}
                          onClick={(e) => e.stopPropagation()} className="flex-shrink-0" />
                        <Avatar className="flex-shrink-0 w-8 h-8">
                          <AvatarFallback className={`text-[10px] font-bold
                            ${isSelected ? 'bg-primary text-primary-foreground' :
                              isAutoDetected ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200' :
                              'bg-muted text-muted-foreground'}`}>
                            {r.isGroup ? '👥' : initials(r.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-foreground truncate">{r.name}</p>
                            {r.isGroup ? (
                              <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-0">
                                Grupo
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-0">
                                Contacto
                              </Badge>
                            )}
                            {isAutoDetected && (
                              <Badge className="text-[8px] h-3.5 px-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 border-0">
                                <Zap className="w-2 h-2 mr-0.5" />Auto
                              </Badge>
                            )}
                          </div>
                          {r.description && (
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{r.description}</p>
                          )}
                          {!r.isGroup && r.area_destino && (
                            <p className="text-[9px] text-primary/70 truncate mt-0.5 flex items-center gap-1">
                              <MapPin className="w-2 h-2" />{r.area_destino}
                            </p>
                          )}
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Message Preview / Editor (placed under the contacts list) */}
          <div className="rounded-xl border border-primary/10 bg-primary/[0.01] dark:bg-primary/[0.02] p-4 space-y-2.5 relative shadow-sm hover:shadow transition-all duration-300 message-preview-container">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary dark:text-primary-foreground uppercase tracking-wider">
                Mensaje de WhatsApp
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={handleCopyMessage}
                  title="Copiar mensaje"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsEditingMessage(!isEditingMessage)}
                >
                  {isEditingMessage ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Edit className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
            {isEditingMessage ? (
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="w-full min-h-[140px] text-xs font-medium bg-card text-foreground border rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-primary shadow-inner message-textarea"
              />
            ) : (
              <div className="text-xs bg-card border rounded-lg p-2.5 font-medium whitespace-pre-wrap leading-relaxed text-muted-foreground min-h-[140px] overflow-y-auto max-h-[180px] shadow-inner message-preview-box">
                {messageText}
              </div>
            )}
          </div>

          {/* Selected Recipients Preview (horizontal chips area) */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Destinatarios a enviar ({selected.size})
            </span>
            {selectedRecipients.length === 0 ? (
              <div className="text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 flex items-center gap-2 animate-fade-slide-up">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Ningún destinatario seleccionado. Buscá y seleccionalos arriba.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-2.5 bg-muted/30 border rounded-xl shadow-inner min-h-[50px] items-center">
                {selectedRecipients.map(recipient => (
                  <div 
                    key={recipient.recipientKey} 
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-xs font-semibold text-primary dark:text-primary-foreground animate-scale-in"
                  >
                    <Avatar className="w-5 h-5">
                      <AvatarFallback className="text-[9px] bg-primary text-primary-foreground font-black">
                        {recipient.isGroup ? '👥' : initials(recipient.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate max-w-[120px]">{recipient.name}</span>
                    <button 
                      onClick={() => toggle(recipient.recipientKey)} 
                      className="ml-1 opacity-60 hover:opacity-100 transition-opacity p-0.5 rounded-full hover:bg-primary/20"
                    >
                      <X className="w-3.5 h-3.5 text-foreground/75" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2 send-btn-container">
            <Button variant="outline" onClick={onBack} disabled={sending} className="gap-2 h-12">
              <ChevronLeft className="w-4 h-4" /> Volver
            </Button>
            <button
              onClick={handleSend}
              disabled={selected.size === 0 || sending}
              className="send-btn flex-1 h-12 rounded-xl text-sm font-bold text-white
                flex items-center justify-center gap-2.5
                bg-primary hover:bg-primary/90
                disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            >
              {sending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
                : <><Send className="w-4 h-4" /> Enviar a {selected.size || '...'} destinatario{selected.size !== 1 ? 's' : ''}</>
              }
            </button>
          </div>
        </div>
        </section>
      </div>
    </div>
  );
}

// ── Contacts Tab ───────────────────────────────────────────────────────────────
function ContactsTab({ contacts, onReload, showToast }) {
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', description: '', area_destino: '', subtypes: '' });
  const [editForm, setEditForm] = useState({ name: '', phone_number: '', description: '', area_destino: '', subtypes: '' });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const filtered = search.trim() === '' ? contacts : contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.area_destino || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone_number || '').includes(search) ||
    (c.subtypes || []).some(s => s.toLowerCase().includes(search.toLowerCase()))
  );

  const allActiveIds = contacts.filter(c => c.is_active).map(c => c.id);
  const allSelected = allActiveIds.length > 0 && allActiveIds.every(id => selected.has(id));
  const toggleSelectAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(allActiveIds));

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || form.phone.replace(/\D/g, '').length < 8) {
      showToast('Completá nombre y teléfono (mín. 8 dígitos)', 'error'); return;
    }
    setSaving(true);
    
    const parsedSubtypes = form.subtypes
      ? form.subtypes.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    try {
      const { error } = await supabase.from('contacts').insert([{
        name: form.name.trim(), phone_number: normalizePhone(form.phone),
        description: form.description.trim() || null,
        area_destino: form.area_destino.trim() || null,
        subtypes: parsedSubtypes,
        is_active: true,
      }]);
      if (error) throw error;
      showToast('Contacto agregado ✓');
      setForm({ name: '', phone: '', description: '', area_destino: '', subtypes: '' });
      setAddOpen(false); onReload();
    } catch (err) {
      showToast(err.message.includes('23505') ? 'Ese número ya existe' : err.message, 'error');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { showToast('El nombre es obligatorio', 'error'); return; }
    setSaving(true);

    const parsedSubtypes = editForm.subtypes
      ? editForm.subtypes.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    try {
      const { error } = await supabase.from('contacts').update({
        name: editForm.name.trim(), phone_number: normalizePhone(editForm.phone_number),
        description: editForm.description?.trim() || null,
        area_destino: editForm.area_destino?.trim() || null,
        subtypes: parsedSubtypes
      }).eq('id', editId);
      if (error) throw error;
      showToast('Cambios guardados ✓'); setEditId(null); onReload();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from('contacts').delete().eq('id', deleteId);
      if (error) throw error;
      showToast('Contacto eliminado'); setDeleteId(null); onReload();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleToggleActive = async (id, current) => {
    await supabase.from('contacts').update({ is_active: !current }).eq('id', id);
    onReload();
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setEditForm({ 
      name: c.name, 
      phone_number: c.phone_number, 
      description: c.description || '', 
      area_destino: c.area_destino || '',
      subtypes: (c.subtypes || []).join(', ')
    });
  };

  return (
    <div className="animate-fade-slide-up space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-10 text-sm" />
        </div>
        <Button variant="outline" size="sm" onClick={toggleSelectAll} className="h-10 gap-1.5 text-sm whitespace-nowrap">
          {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
        </Button>
        <Button onClick={() => setAddOpen(true)} size="sm" className="h-10 gap-1.5 text-sm">
          <Plus className="w-4 h-4" /> Agregar
        </Button>
      </div>

      <ScrollArea className="h-[min(520px,60vh)] rounded-2xl border bg-card">
        <div className="p-3 space-y-1.5">
          {filtered.length === 0 && (
            <div className="py-16 text-center text-muted-foreground text-sm">
              {search.trim() === '' ? 'Escribí en el buscador superior para ver contactos...' : 'Sin contactos'}
            </div>
          )}
          {filtered.map(c => {
            const isEditing = editId === c.id;
            const isChecked = selected.has(c.id);
            return (
              <div key={c.id} className={`contact-card group flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all
                ${isEditing ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/40'}`}>
                <Checkbox checked={isChecked} onCheckedChange={() => {
                  setSelected(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; });
                }} />
                <Avatar className="flex-shrink-0 w-10 h-10">
                  <AvatarFallback className={`text-sm font-bold ${c.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {initials(c.name)}
                  </AvatarFallback>
                </Avatar>

                {isEditing ? (
                  <div className="flex-1 grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-lg border border-primary/10">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Nombre</Label>
                      <Input value={editForm.name} onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="Nombre" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Teléfono</Label>
                      <Input value={editForm.phone_number} onChange={(e) => setEditForm(p => ({ ...p, phone_number: e.target.value }))}
                        placeholder="Teléfono" className="h-8 text-sm font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Área destino</Label>
                      <Input value={editForm.area_destino} onChange={(e) => setEditForm(p => ({ ...p, area_destino: e.target.value }))}
                        placeholder="Área destino (ej: ATENCIÓN CIUDADANA)" className="h-8 text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Subtipos predeterminados (separados por coma)</Label>
                      <Input value={editForm.subtypes} onChange={(e) => setEditForm(p => ({ ...p, subtypes: e.target.value }))}
                        placeholder="Ej: BACHES, ALUMBRADO PÚBLICO, QUEJAS" className="h-8 text-xs font-mono uppercase" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Descripción / cargo</Label>
                      <Input value={editForm.description} onChange={(e) => setEditForm(p => ({ ...p, description: e.target.value }))}
                        placeholder="Descripción / apodo" className="h-8 text-sm" />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-foreground truncate">{c.name}</p>
                      {!c.is_active && <Badge variant="outline" className="text-[9px] h-4 py-0 bg-muted/50">Inactivo</Badge>}
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground/80 mt-0.5 font-medium">{c.description}</p>}
                    
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {c.area_destino && (
                        <Badge variant="secondary" className="text-[9px] font-black flex items-center gap-0.5 px-2 py-0.5 bg-primary/5 text-primary border border-primary/10">
                          <MapPin className="w-2.5 h-2.5" /> {c.area_destino.toUpperCase()}
                        </Badge>
                      )}
                      {c.subtypes && c.subtypes.map(sub => (
                        <Badge key={sub} variant="outline" className="text-[9px] font-bold px-2 py-0.5 bg-secondary/40 border-secondary-foreground/10 text-secondary-foreground/80">
                          {sub}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="icon" onClick={handleSaveEdit} disabled={saving}
                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditId(null)}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Switch checked={c.is_active} onCheckedChange={() => handleToggleActive(c.id, c.is_active)} className="scale-75" />
                          </TooltipTrigger>
                          <TooltipContent><p>{c.is_active ? 'Desactivar' : 'Activar'}</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button variant="ghost" size="icon" onClick={() => startEdit(c)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(c.id)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Nuevo Contacto de Derivación</DialogTitle>
            <DialogDescription className="text-xs">Completá los datos del destinatario para el protocolo</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-xs font-semibold text-muted-foreground">Nombre / Identificación *</Label>
              <Input id="add-name" placeholder="Ej. Mesa de Entradas"
                value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone" className="text-xs font-semibold text-muted-foreground">Teléfono de WhatsApp *</Label>
              <Input id="add-phone" placeholder="Ej. 549342555555" className="font-mono h-10"
                value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} />
              <p className="text-[10px] text-muted-foreground">Con código de país e internacional: 549 + código de área sin el 15 + número</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-area" className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                Área de derivación en PDF <span className="text-muted-foreground font-normal">(para detección automática)</span>
              </Label>
              <Input id="add-area" placeholder="Ej. ATENCIÓN CIUDADANA"
                value={form.area_destino} onChange={(e) => setForm(p => ({ ...p, area_destino: e.target.value }))} className="h-10" />
              <p className="text-[10px] text-muted-foreground">Debe coincidir exactamente con el campo "Area destino" del PDF</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-subtypes" className="text-xs font-semibold text-muted-foreground">
                Subtipos asociados <span className="text-muted-foreground font-normal">(para autoselección)</span>
              </Label>
              <Input id="add-subtypes" placeholder="Ej: BACHES, ALUMBRADO PÚBLICO, QUEJAS"
                value={form.subtypes} onChange={(e) => setForm(p => ({ ...p, subtypes: e.target.value }))} className="h-10 font-mono text-xs uppercase" />
              <p className="text-[10px] text-muted-foreground">Separados por coma. Se auto-seleccionará el contacto cuando el PDF coincida.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-desc" className="text-xs font-semibold text-muted-foreground">Descripción o cargo <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input id="add-desc" placeholder="Ej. Coordinador de Atención al Vecino"
                value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} className="h-10" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" disabled={saving} className="flex-1 gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />} Agregar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminás este contacto?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Groups Tab ─────────────────────────────────────────────────────────────────
function GroupsTab({ groups, onReload, showToast, backendUrl, botStatus }) {
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({ name: '', group_jid: '', description: '', subtypes: '' });
  const [editForm, setEditForm] = useState({ name: '', group_jid: '', description: '', subtypes: '' });
  const [saving, setSaving] = useState(false);
  const [waGroups, setWaGroups] = useState([]);
  const [loadingWa, setLoadingWa] = useState(false);

  const filtered = search.trim() === '' ? groups : groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (g.group_jid || '').toLowerCase().includes(search.toLowerCase()) ||
    (g.subtypes || []).some(s => s.toLowerCase().includes(search.toLowerCase()))
  );

  const loadWaGroups = async () => {
    if (!botStatus.connected) {
      showToast('Conectá WhatsApp primero (pestaña Estado)', 'error');
      return;
    }
    setLoadingWa(true);
    try {
      const res = await fetch(`${backendUrl}/groups`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Error al listar grupos');
      setWaGroups(data.groups || []);
      if ((data.groups || []).length === 0) showToast('No se encontraron grupos en WhatsApp', 'error');
    } catch (err) {
      showToast(err.message || 'Error al cargar grupos de WhatsApp', 'error');
    } finally {
      setLoadingWa(false);
    }
  };

  const applyWaGroup = (jid) => {
    const found = waGroups.find(g => g.id === jid);
    if (found) {
      setForm(p => ({ ...p, group_jid: found.id, name: p.name.trim() ? p.name : found.name }));
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const jid = form.group_jid.trim();
    if (!form.name.trim() || !jid.includes('@g.us')) {
      showToast('Completá nombre y JID de grupo (formato …@g.us)', 'error');
      return;
    }
    setSaving(true);
    const parsedSubtypes = form.subtypes
      ? form.subtypes.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
    try {
      const { error } = await supabase.from('whatsapp_groups').insert([{
        name: form.name.trim(),
        group_jid: jid,
        description: form.description.trim() || null,
        subtypes: parsedSubtypes,
        is_active: true,
      }]);
      if (error) throw error;
      showToast('Grupo agregado ✓');
      setForm({ name: '', group_jid: '', description: '', subtypes: '' });
      setAddOpen(false);
      onReload();
    } catch (err) {
      showToast(err.message.includes('23505') ? 'Ese grupo ya está registrado' : err.message, 'error');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = async () => {
    const jid = editForm.group_jid.trim();
    if (!editForm.name.trim() || !jid.includes('@g.us')) {
      showToast('Nombre y JID de grupo son obligatorios', 'error');
      return;
    }
    setSaving(true);
    const parsedSubtypes = editForm.subtypes
      ? editForm.subtypes.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
    try {
      const { error } = await supabase.from('whatsapp_groups').update({
        name: editForm.name.trim(),
        group_jid: jid,
        description: editForm.description?.trim() || null,
        subtypes: parsedSubtypes,
      }).eq('id', editId);
      if (error) throw error;
      showToast('Cambios guardados ✓');
      setEditId(null);
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      const { error } = await supabase.from('whatsapp_groups').delete().eq('id', deleteId);
      if (error) throw error;
      showToast('Grupo eliminado');
      setDeleteId(null);
      onReload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleActive = async (id, current) => {
    await supabase.from('whatsapp_groups').update({ is_active: !current }).eq('id', id);
    onReload();
  };

  const startEdit = (g) => {
    setEditId(g.id);
    setEditForm({
      name: g.name,
      group_jid: g.group_jid,
      description: g.description || '',
      subtypes: (g.subtypes || []).join(', '),
    });
  };

  return (
    <div className="animate-fade-slide-up space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar grupo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-10 text-sm" />
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm" className="h-10 gap-1.5 text-sm">
          <Plus className="w-4 h-4" /> Agregar grupo
        </Button>
      </div>

      <ScrollArea className="h-[min(520px,60vh)] rounded-2xl border bg-card">
        <div className="p-3 space-y-1.5">
          {filtered.length === 0 && (
            <div className="py-16 text-center text-muted-foreground text-sm">
              {groups.length === 0
                ? 'No hay grupos configurados. Agregá uno para derivar PDFs a chats grupales.'
                : 'Sin resultados para la búsqueda'}
            </div>
          )}
          {filtered.map(g => {
            const isEditing = editId === g.id;
            return (
              <div key={g.id} className={`contact-card group flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all
                ${isEditing ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/40'}`}>
                <Avatar className="flex-shrink-0 w-10 h-10">
                  <AvatarFallback className={`text-sm font-bold ${g.is_active ? 'bg-blue-500/10 text-blue-600' : 'bg-muted text-muted-foreground'}`}>
                    👥
                  </AvatarFallback>
                </Avatar>
                {isEditing ? (
                  <div className="flex-1 grid grid-cols-1 gap-2 bg-muted/30 p-3 rounded-lg border border-primary/10">
                    <Input value={editForm.name} onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="Nombre" className="h-8 text-sm" />
                    <Input value={editForm.group_jid} onChange={(e) => setEditForm(p => ({ ...p, group_jid: e.target.value }))} placeholder="JID …@g.us" className="h-8 text-xs font-mono" />
                    <Input value={editForm.subtypes} onChange={(e) => setEditForm(p => ({ ...p, subtypes: e.target.value }))} placeholder="Subtipos (coma)" className="h-8 text-xs font-mono uppercase" />
                    <Input value={editForm.description} onChange={(e) => setEditForm(p => ({ ...p, description: e.target.value }))} placeholder="Descripción" className="h-8 text-sm" />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold truncate">{g.name}</p>
                      {!g.is_active && <Badge variant="outline" className="text-[9px] h-4 py-0">Inactivo</Badge>}
                    </div>
                    {g.description && <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>}
                    <p className="text-[10px] font-mono text-muted-foreground/70 truncate mt-1">{g.group_jid}</p>
                    {g.subtypes?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {g.subtypes.map(sub => (
                          <Badge key={sub} variant="outline" className="text-[9px] font-bold px-2 py-0.5">{sub}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="icon" onClick={handleSaveEdit} disabled={saving} className="h-8 w-8 text-emerald-600">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setEditId(null)} className="h-8 w-8"><X className="w-4 h-4" /></Button>
                    </>
                  ) : (
                    <>
                      <Switch checked={g.is_active} onCheckedChange={() => handleToggleActive(g.id, g.is_active)} className="scale-75" />
                      <Button variant="ghost" size="icon" onClick={() => startEdit(g)} className="h-8 w-8 opacity-0 group-hover:opacity-100"><Edit className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(g.id)} className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Nuevo grupo de derivación</DialogTitle>
            <DialogDescription className="text-xs">
              El bot debe estar en el grupo de WhatsApp. Podés cargar la lista desde la cuenta conectada.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={loadWaGroups} disabled={loadingWa || !botStatus.connected} className="gap-2">
                {loadingWa ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Cargar desde WhatsApp
              </Button>
            </div>
            {waGroups.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Grupo en WhatsApp</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={form.group_jid}
                  onChange={(e) => applyWaGroup(e.target.value)}
                >
                  <option value="">Seleccionar grupo...</option>
                  {waGroups.map(wg => (
                    <option key={wg.id} value={wg.id}>{wg.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Nombre *</Label>
              <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ej. Obras Públicas - Derivaciones" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">JID del grupo *</Label>
              <Input value={form.group_jid} onChange={(e) => setForm(p => ({ ...p, group_jid: e.target.value }))} placeholder="120363…@g.us" className="h-10 font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Subtipos (autoselección, separados por coma)</Label>
              <Input value={form.subtypes} onChange={(e) => setForm(p => ({ ...p, subtypes: e.target.value }))} className="h-10 font-mono text-xs uppercase" placeholder="BACHES, ALUMBRADO" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Descripción (opcional)</Label>
              <Input value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} className="h-10" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} className="flex-1">Cancelar</Button>
              <Button type="submit" disabled={saving} className="flex-1 gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Agregar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminás este grupo?</AlertDialogTitle>
            <AlertDialogDescription>Dejará de aparecer como destinatario en las derivaciones.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Status Tab ─────────────────────────────────────────────────────────────────
function StatusTab({ botStatus, contacts, onDisconnect, onReconnect, disconnecting, reconnecting }) {
  return (
    <div className="animate-fade-slide-up space-y-4">
      {(botStatus.connected || botStatus.offline) && (
        <Card className={`border-2 ${botStatus.offline ? 'border-muted' : 'border-emerald-200 dark:border-emerald-800'}`}>
          <CardContent className="p-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${botStatus.offline ? 'bg-muted' : 'bg-emerald-50 dark:bg-emerald-950'}`}>
                {botStatus.offline ? <WifiOff className="w-7 h-7 text-muted-foreground" /> : <Wifi className="w-7 h-7 text-emerald-500" />}
              </div>
              <div>
                <p className="text-base font-bold">{botStatus.offline ? 'Sin conexión' : 'WhatsApp conectado'}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {botStatus.offline ? 'Reintentando conexión...' :
                   (botStatus.phoneUser ? `+${botStatus.phoneUser.split('@')[0]}` : 'Activo')}
                </p>
              </div>
            </div>
            {botStatus.connected && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDisconnect}
                disabled={disconnecting}
                className="gap-2 flex-shrink-0"
              >
                {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Desconectar
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!botStatus.connected && !botStatus.offline && (
        <Card className={`border-2 ${
          botStatus.connecting && !botStatus.qr 
            ? 'border-primary/20 bg-primary/[0.01]' 
            : 'border-red-200 dark:border-red-900 bg-red-500/[0.02]'
        }`}>
          <CardHeader className="text-center pb-4">
            {botStatus.connecting && !botStatus.qr ? (
              <>
                <Badge className="mx-auto mb-2 text-[10px] font-black uppercase tracking-wider animate-pulse px-3 py-1 bg-primary text-primary-foreground border-0">
                  ⚡ CONECTANDO...
                </Badge>
                <CardTitle className="text-base font-black text-primary leading-tight">
                  INICIANDO SESIÓN DE WHATSAPP
                </CardTitle>
                <CardDescription className="text-xs font-semibold mt-1">
                  Se están cargando las credenciales guardadas. Aguardá unos segundos.
                </CardDescription>
              </>
            ) : (
              <>
                <Badge variant="destructive" className="mx-auto mb-2 text-[10px] font-black uppercase tracking-wider animate-pulse px-3 py-1 bg-red-600 text-white">
                  ⚠️ VINCULACIÓN REQUERIDA
                </Badge>
                <CardTitle className="text-base font-black text-red-600 dark:text-red-400 leading-tight">
                  ESCANEA EL QR CON EL CELULAR DEL PAI PARA CONECTARTE
                </CardTitle>
                <CardDescription className="text-xs font-semibold mt-1">
                  Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            {botStatus.qr ? (
              <div className="p-3 bg-white rounded-2xl shadow-md border">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(botStatus.qr)}&size=200x200`} alt="QR" className="w-48 h-48 rounded-lg" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">
                  {botStatus.connecting ? 'Conectando con WhatsApp...' : 'Generando código QR...'}
                </p>
                {!botStatus.connecting && (
                  <p className="text-xs text-muted-foreground max-w-xs text-center">
                    {botStatus.stalled
                      ? 'La sesión quedó colgada en el servidor. Probá reiniciar la conexión.'
                      : 'Si tarda más de un minuto, reiniciá la conexión.'}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onReconnect}
                    disabled={reconnecting || disconnecting || botStatus.connecting}
                    className="gap-2"
                  >
                    {reconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Reiniciar conexión
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onDisconnect}
                    disabled={disconnecting || reconnecting}
                    className="gap-2"
                  >
                    {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Borrar sesión y nuevo QR
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HistoryItem({ item }) {
  const [expanded, setExpanded] = useState(false);
  const elementRef = useRef(null);
  const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
  const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const isSuccess = item.status === 'success';

  useEffect(() => {
    if (expanded && elementRef.current) {
      const t = setTimeout(() => {
        elementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [expanded]);

  return (
    <div 
      ref={elementRef}
      className={`border transition-all duration-200 text-sm font-medium cursor-pointer overflow-hidden ${
        isSuccess
          ? 'border-emerald-500/15 dark:border-emerald-500/10 bg-emerald-500/[0.03] dark:bg-emerald-950/5 hover:bg-emerald-500/[0.06] dark:hover:bg-emerald-950/15'
          : 'border-rose-500/15 dark:border-rose-500/10 bg-rose-500/[0.03] dark:bg-rose-950/5 hover:bg-rose-500/[0.06] dark:hover:bg-rose-950/15'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
          <span className="font-bold text-foreground uppercase tracking-wide">
            {item.subtipo || 'SIN SUBTIPO'}
          </span>

          <span className="text-muted-foreground">|</span>

          <span className="text-muted-foreground">
            Para: <strong className="text-foreground font-semibold">{item.contact_name}</strong>
          </span>

          <span className="text-muted-foreground">|</span>

          <span className="text-xs text-muted-foreground font-medium">
            Sol. Nro {item.solicitud_nro || 'S/N'}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono self-start md:self-auto flex-shrink-0">
          <span>{dateStr} {timeStr}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <div className={`transition-all duration-300 ease-in-out border-t border-border/40 bg-card ${
        expanded ? 'max-h-[300px] opacity-100 p-4' : 'max-h-0 opacity-0 pointer-events-none'
      }`}>
        {item.message_text ? (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Detalle del Mensaje Enviado</p>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed bg-muted/40 p-3 rounded-xl border">
              {item.message_text}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No hay contenido de mensaje registrado.</p>
        )}
      </div>
    </div>
  );
}

function DashboardHistoryItem({ item }) {
  const [expanded, setExpanded] = useState(false);
  const elementRef = useRef(null);
  const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
  const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const isSuccess = item.status === 'success';

  useEffect(() => {
    if (expanded && elementRef.current) {
      const t = setTimeout(() => {
        elementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [expanded]);

  return (
    <div 
      ref={elementRef}
      className={`border transition-all duration-200 text-sm font-medium cursor-pointer overflow-hidden ${
        isSuccess
          ? 'border-emerald-500/15 dark:border-emerald-500/10 bg-emerald-500/[0.03] dark:bg-emerald-950/5 hover:bg-emerald-500/[0.06] dark:hover:bg-emerald-950/15'
          : 'border-rose-500/15 dark:border-rose-500/10 bg-rose-500/[0.03] dark:bg-rose-950/5 hover:bg-rose-500/[0.06] dark:hover:bg-rose-950/15'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
          <span className="font-bold text-foreground uppercase tracking-wide">
            {item.subtipo || 'SIN SUBTIPO'}
          </span>

          <span className="text-muted-foreground">|</span>

          <span className="text-muted-foreground">
            Para: <strong className="text-foreground font-semibold">{item.contact_name}</strong>
          </span>

          <span className="text-muted-foreground">|</span>

          <span className="text-xs text-muted-foreground font-medium">
            Sol. Nro {item.solicitud_nro || 'S/N'}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono self-start sm:self-auto flex-shrink-0">
          <span>{dateStr} {timeStr}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      <div className={`transition-all duration-300 ease-in-out border-t border-border/40 bg-card ${
        expanded ? 'max-h-[300px] opacity-100 p-4' : 'max-h-0 opacity-0 pointer-events-none'
      }`}>
        {item.message_text ? (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Detalle del Mensaje Enviado</p>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed bg-muted/40 p-3 rounded-xl border">
              {item.message_text}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No hay contenido de mensaje registrado.</p>
        )}
      </div>
    </div>
  );
}

function HistoryTab({ shipments, loading, onReload }) {
  // Agrupar shipments por día
  const groups = useMemo(() => {
    const map = {};
    shipments.forEach(s => {
      if (!s.created_at) return;
      const dateObj = new Date(s.created_at);
      const localDateStr = dateObj.toLocaleDateString('es-AR', { year: 'numeric', month: '2-digit', day: '2-digit' });
      
      let dayLabel = localDateStr;
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      
      if (dateObj.toDateString() === today.toDateString()) {
        dayLabel = 'Hoy';
      } else if (dateObj.toDateString() === yesterday.toDateString()) {
        dayLabel = 'Ayer';
      } else {
        dayLabel = dateObj.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
        dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
      }
      
      if (!map[localDateStr]) {
        map[localDateStr] = {
          label: dayLabel,
          items: []
        };
      }
      map[localDateStr].items.push(s);
    });
    return Object.values(map);
  }, [shipments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <p className="text-xs text-muted-foreground">Registro de todos los PDFs enviados y su estado.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onReload}
          disabled={loading}
          className="gap-2 h-8"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {loading && shipments.length === 0 ? (
        <div className="space-y-4 py-8">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : shipments.length === 0 ? (
        <div className="border border-dashed py-12 text-center bg-card/20">
          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <History className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-muted-foreground">No hay envíos registrados</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Los documentos PDF que envíes a través de esta plataforma aparecerán aquí agrupados por día.
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="h-[55vh] pr-2">
          <div className="space-y-6">
            {groups.map(group => (
              <div key={group.label} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                    {group.label}
                  </span>
                  <Separator className="flex-grow" />
                </div>
                <div className="space-y-3">
                  {group.items.map(item => (
                    <HistoryItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [configTab, setConfigTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [botStatus, setBotStatus] = useState({ connected: false, connecting: false, checking: true, qr: null, offline: false, phoneUser: null, stalled: false });
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('send');
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [sendingDetails, setSendingDetails] = useState(null);
  const autoCloseTimeoutRef = useRef(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);
  
  const [shipments, setShipments] = useState([]);
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

   const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const [subtypesCatalog, setSubtypesCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogPrefill, setCatalogPrefill] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [derivationStatus, setDerivationStatus] = useState(null); // 'derivar' | 'no-derivar' | 'no-catalogado' | null

  const filteredShipments = useMemo(() => {
    if (!historySearch.trim()) return shipments;
    const term = historySearch.toLowerCase().trim();
    return shipments.filter(s => {
      const sol = (s.solicitud_nro || '').toLowerCase();
      const sub = (s.subtipo || '').toLowerCase();
      const contact = (s.contact_name || '').toLowerCase();
      const msg = (s.message_text || '').toLowerCase();
      return sol.includes(term) || sub.includes(term) || contact.includes(term) || msg.includes(term);
    });
  }, [shipments, historySearch]);

  const handleOpenConfig = () => {
    setConfigTab(botStatus.connected ? 'contacts' : 'status');
    setConfigOpen(true);
  };

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  useEffect(() => {
    return () => {
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('contacts').select('*').order('name');
      if (error) throw error;
      setContacts(data || []);
    } catch { showToast('Error cargando contactos', 'error'); }
    finally { setLoadingContacts(false); }
  }, [showToast]);

  const loadGroups = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('whatsapp_groups').select('*').order('name');
      if (error) throw error;
      setGroups(data || []);
    } catch {
      showToast('Error cargando grupos (¿ejecutaste la migración en Supabase?)', 'error');
    } finally {
      setLoadingGroups(false);
    }
  }, [showToast]);

  const loadShipments = useCallback(async () => {
    setLoadingShipments(true);
    try {
      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setShipments(data || []);
    } catch (err) {
      console.error('Error al cargar historial:', err);
      showToast('Error al cargar el historial de envíos', 'error');
    } finally {
      setLoadingShipments(false);
    }
  }, [showToast]);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const { data, error } = await supabase
        .from('subtypes_catalog')
        .select('*')
        .order('subtipo');
      if (error) throw error;
      setSubtypesCatalog(data || []);
    } catch (err) {
      console.error('Error al cargar catálogo PAI:', err);
      showToast('Error al cargar catálogo PAI', 'error');
    } finally {
      setLoadingCatalog(false);
    }
  }, [showToast]);

  const handleAddSubtipoToCatalog = (subtipo, tipo) => {
    setCatalogPrefill({
      tipo: tipo || 'RECLAMO',
      subtipo: subtipo || '',
      categoria: '',
      derivar: true,
      comentarios: ''
    });
    setCatalogOpen(true);
  };

  useEffect(() => {
    if (historyOpen) {
      loadShipments();
    }
  }, [historyOpen, loadShipments]);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const res = await fetch(`${backendUrl}/reconnect`, { method: 'POST' });
      if (!res.ok) throw new Error();
      showToast('Reiniciando conexión con WhatsApp...');
    } catch {
      showToast('Error al reiniciar la conexión', 'error');
    } finally {
      setReconnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch(`${backendUrl}/disconnect`, { method: 'POST' });
      if (!res.ok) throw new Error();
      showToast('Sesión cerrada y credenciales borradas de Supabase con éxito ✓');
    } catch {
      showToast('Error al intentar desconectar la sesión', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  useEffect(() => { 
    loadContacts(); 
    loadGroups();
    loadShipments();
    loadCatalog();
  }, [loadContacts, loadGroups, loadShipments, loadCatalog]);

  useEffect(() => {
    let failedCount = 0;
    const check = async () => {
      try {
        const res = await fetch(`${backendUrl}/status`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        failedCount = 0;
        setBotStatus({
          connected: !!data.connected,
          connecting: !!data.connecting,
          checking: false,
          qr: data.qr || null,
          offline: false,
          phoneUser: data.phone_user || null,
          stalled: !!data.stalled || (!data.connected && !data.connecting && !data.qr)
        });
      } catch {
        failedCount++;
        if (failedCount >= 3) {
          setBotStatus({ connected: false, connecting: false, checking: false, qr: null, offline: true, phoneUser: null, stalled: false });
        }
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  // Window-Wide Drag and Drop handlers
  useEffect(() => {
    const handleDragEnter = (e) => {
      if (!botStatus.connected) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDraggingFile(true);
      }
    };

    const handleDragLeave = (e) => {
      if (!botStatus.connected) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDraggingFile(false);
      }
    };

    const handleDragOver = (e) => {
      if (!botStatus.connected) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e) => {
      if (!botStatus.connected) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);
      dragCounter.current = 0;

      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile && droppedFile.type === 'application/pdf' && droppedFile.size <= 52428800) {
        setFile(droppedFile);
        setStep(1);
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      } else if (droppedFile) {
        showToast('Carga cancelada: Solo archivos PDF de hasta 50 MB.', 'error');
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [botStatus.connected, showToast]);

  const handleSend = async (recipients, pdfInfoOrArea, messageText) => {
    if (!file || recipients.length === 0) return;
    const pdfInfo = typeof pdfInfoOrArea === 'object' ? pdfInfoOrArea : null;
    const areaDestino = pdfInfo ? pdfInfo.areaDestino : pdfInfoOrArea;

    setSending(true);
    setProgress(10);
    setProgressText('Subiendo archivo...');
    setSendingDetails({
      subtipo: pdfInfo?.subtipo || 'Reclamo',
      solicitudNro: pdfInfo?.solicitudNro || '',
      total: recipients.length,
      current: 0,
      currentName: ''
    });

    const uniqueName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    
    const cleanFileNameString = (str) => {
      return str.replace(/[\\/:*?"<>|]/g, '').trim();
    };

    let displayName = file.name;
    if (pdfInfo && pdfInfo.solicitudNro) {
      const sol = cleanFileNameString(pdfInfo.solicitudNro);
      const sub = pdfInfo.subtipo ? cleanFileNameString(pdfInfo.subtipo.toUpperCase()) : '';
      displayName = sub ? `${sol}(${sub}).pdf` : `${sol}.pdf`;
    } else {
      displayName = cleanFileNameString(file.name);
      if (!displayName.toLowerCase().endsWith('.pdf')) {
        displayName += '.pdf';
      }
    }

    try {
      const { error: uploadError } = await supabase.storage.from('pdfs').upload(uniqueName, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;
      
      setProgress(50);
      const results = [];
      for (const [i, recipient] of recipients.entries()) {
        setProgressText(`Enviando a ${recipient.name}... (${i + 1}/${recipients.length})`);
        setSendingDetails(prev => ({
          ...prev,
          current: i + 1,
          currentName: recipient.name
        }));
        try {
          const payload = recipient.isGroup
            ? {
                fileName: uniqueName,
                groupJid: recipient.group_jid,
                isGroup: true,
                caption: messageText,
                contactName: recipient.name,
                solicitudNro: pdfInfo?.solicitudNro,
                subtipo: pdfInfo?.subtipo,
                displayName: displayName
              }
            : {
                fileName: uniqueName,
                phoneNumber: recipient.phone_number,
                caption: messageText,
                contactName: recipient.name,
                solicitudNro: pdfInfo?.solicitudNro,
                subtipo: pdfInfo?.subtipo,
                displayName: displayName
              };
          const res = await fetch(`${backendUrl}/send-pdf`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const result = await res.json();
          results.push({ ok: res.ok && result.success });
        } catch { results.push({ ok: false }); }
        setProgress(50 + Math.round(((i + 1) / recipients.length) * 50));
      }
      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      setSendingDetails(prev => ({
        ...prev,
        successCount: ok,
        failCount: fail
      }));
      setProgress(100);
      if (fail === 0) showToast(`¡Enviado a ${ok} destinatario${ok > 1 ? 's' : ''}! ✓`);
      else showToast(`${ok} enviado${ok !== 1 ? 's' : ''}, ${fail} falló`, 'error');
      
      // Actualizar historial
      loadShipments();

      // Cerrar automáticamente tras 10 segundos
      autoCloseTimeoutRef.current = setTimeout(() => {
        handleCloseSending();
      }, 10000);
    } catch (err) {
      showToast(err.message, 'error');
      setSending(false);
      setProgress(0);
      setSendingDetails(null);
    }
  };

  useEffect(() => {
    if (step === 1 && file) {
      const t = setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [step, file]);

  useEffect(() => {
    if (step === 1 && derivationStatus) {
      const t = setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [derivationStatus, step]);

  const handleCloseSending = () => {
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    setFile(null);
    setStep(0);
    setSending(false);
    setProgress(0);
    setProgressText('');
    setSendingDetails(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };


  return (
    <TooltipProvider>
      <div className={`min-h-screen flex flex-col transition-all duration-500
        ${derivationStatus === 'derivar' 
          ? 'bg-gradient-to-br from-emerald-500/[0.12] via-background to-emerald-500/[0.04] dark:from-emerald-950/30 dark:via-background dark:to-emerald-950/10' 
          : derivationStatus === 'no-derivar' 
            ? 'bg-gradient-to-br from-rose-500/[0.12] via-background to-rose-500/[0.04] dark:from-rose-950/30 dark:via-background dark:to-rose-950/10' 
            : derivationStatus === 'no-sac'
              ? 'bg-gradient-to-br from-amber-500/[0.12] via-background to-amber-500/[0.04] dark:from-amber-950/20 dark:via-background dark:to-amber-950/5'
              : 'bg-background'}`}>

        {/* ── Cabecera simplificada y adaptada para Google Sites ── */}
        <div className="max-w-6xl mx-auto w-full px-4 pt-8 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 border-b-2 border-[#003b73] msf-header-container">
          <div className="flex flex-col gap-2">
            <h1 
              className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-extrabold tracking-tighter leading-[0.95] uppercase select-none transition-all duration-300 text-foreground msf-title"
            >
              Protocolo de Acción Inmediata
            </h1>
            <p className="text-xs sm:text-sm font-extrabold text-muted-foreground uppercase tracking-widest pl-1 mt-1 msf-subtitle">
              Derivaciones · Atención Ciudadana
            </p>
          </div>
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={() => setHelpOpen(true)} 
                  className="inline-flex items-center justify-center h-10 w-10 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 active:scale-95 transition-all duration-150 cursor-pointer"
                >
                  <HelpCircle className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>¿Cómo funciona?</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={() => setDark(!dark)} 
                  className="inline-flex items-center justify-center h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent active:scale-95 transition-all duration-150 cursor-pointer"
                >
                  {dark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
                </button>
              </TooltipTrigger>
              <TooltipContent><p>{dark ? 'Modo claro' : 'Modo oscuro'}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={() => {
                    loadShipments();
                    setHistoryOpen(true);
                  }} 
                  className="inline-flex items-center justify-center h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent active:scale-95 transition-all duration-150 cursor-pointer"
                >
                  <History className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>Historial Completo</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={() => {
                    loadCatalog();
                    setCatalogOpen(true);
                  }} 
                  className="inline-flex items-center justify-center h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent active:scale-95 transition-all duration-150 cursor-pointer"
                >
                  <BookOpen className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>Catálogo PAI</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={handleOpenConfig} 
                  className={`inline-flex items-center justify-center h-10 w-10 rounded-xl active:scale-95 transition-all duration-150 cursor-pointer ${
                    !botStatus.connected 
                      ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse ring-2 ring-red-500/25' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <Settings className="w-[18px] h-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>Configuración</p></TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Main content (solo el flujo de envío de 2 pasos) ── */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 overflow-x-hidden relative">
          {isDraggingFile && (
            <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-primary/10 dark:bg-primary/20 backdrop-blur-md animate-fade-in pointer-events-none">
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <div className="absolute w-[80vw] aspect-square rounded-full bg-primary/5 border-2 border-primary/20 animate-radar-1" />
                <div className="absolute w-[80vw] aspect-square rounded-full bg-primary/5 border-2 border-primary/20 animate-radar-2" />
                <div className="absolute w-[80vw] aspect-square rounded-full bg-primary/5 border-2 border-primary/20 animate-radar-3" />
              </div>
              <div className="relative z-10 flex flex-col items-center gap-4 text-center max-w-md mx-4 animate-scale-in">
                <UploadCloud className="w-20 h-20 text-primary animate-gentle-float" />
                <h2 className="text-3xl font-black tracking-tight text-foreground uppercase">
                  ¡Soltalo acá!
                </h2>
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Soltá el PDF del reclamo en cualquier parte
                </p>
              </div>
            </div>
          )}

          {step === 0 && (
            <div className="animate-slide-backward flex flex-col items-center gap-6 w-full">
              <DropZone 
                onFile={(f) => {
                  setFile(f);
                  setStep(1);
                  requestAnimationFrame(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  });
                }} 
                botStatus={botStatus}
                onOpenConfig={handleOpenConfig}
              />
            </div>
          )}
          {step === 1 && file && (
            <div className="animate-slide-forward w-full">
              <PreviewAndPick
                file={file} 
                contacts={loadingContacts ? [] : contacts}
                groups={loadingGroups ? [] : groups}
                subtypesCatalog={subtypesCatalog}
                onAddSubtipoToCatalog={handleAddSubtipoToCatalog}
                onBack={() => {
                  setFile(null);
                  setStep(0);
                  setDerivationStatus(null);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onSend={handleSend} sending={sending}
                progress={progress} progressText={progressText}
                onDerivationChange={setDerivationStatus}
                onCatalogSearch={(query) => { setCatalogSearch(query); setCatalogOpen(true); }}
                showToast={showToast}
              />
            </div>
          )}

          {/* Mini Historial (solo en pantalla inicial, no compite con el PDF) */}
          {step === 0 && (
          <div className="mt-12 w-full max-w-4xl mx-auto space-y-4">
            <div className="flex items-center gap-2 border-b pb-2">
              <History className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">Últimas Derivaciones</h2>
              <span className="text-xs text-muted-foreground ml-auto">Últimos 5 envíos</span>
            </div>

            {loadingShipments && shipments.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : shipments.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No hay derivaciones registradas recientemente.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {shipments.slice(0, 5).map((item) => (
                  <DashboardHistoryItem key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
          )}
        </main>

        <footer className="w-full bg-gradient-to-r from-[#002144] via-[#003b73] to-[#002144] text-white py-10 px-6 mt-16 border-t border-[#003b73]/30 relative overflow-hidden">
          {/* Línea de brillo superior */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
          
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
            {/* Lado Izquierdo: Marca Municipal */}
            <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
              <div className="transition-all duration-300 hover:scale-[1.03] flex items-center justify-center">
                <img 
                  src="/marca_muni/SF_Horizontal_Blanco.png" 
                  alt="Municipalidad de Santa Fe" 
                  className="h-12 sm:h-14 w-auto object-contain select-none" 
                />
              </div>
              <div>
                <p className="font-bold text-sm tracking-wide text-white">Municipalidad de la Ciudad de Santa Fe</p>
                <p className="text-xs text-white/60 font-light mt-0.5">Atención Ciudadana · Protocolo de Acción Inmediata (PAI)</p>
              </div>
            </div>

            {/* Lado Derecho: Copyright y Autoría */}
            <div className="flex flex-col items-center md:items-end gap-2 text-center md:text-right">
              <span className="text-xs text-white/70 font-medium">
                © {new Date().getFullYear()} · Todos los derechos reservados
              </span>
              <span className="text-[11px] text-white/40 font-light tracking-widest uppercase transition-all duration-300 hover:text-white/60">
                Desarrollado por <span className="font-semibold text-white/60 hover:text-cyan-400 transition-colors duration-200 cursor-default">Renzo</span>
              </span>
            </div>
          </div>
        </footer>

        {/* ── Modal de Configuración Único (Contactos + Estado del Bot) ── */}
        <Dialog open={configOpen} onOpenChange={setConfigOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Configuración de Derivaciones</DialogTitle>
              <DialogDescription>Gestioná los destinatarios del protocolo y el estado de la conexión a WhatsApp.</DialogDescription>
            </DialogHeader>
            <Tabs value={configTab} onValueChange={setConfigTab} className="w-full mt-2">
              <TabsList className="grid grid-cols-3 max-w-lg mx-auto mb-6">
                <TabsTrigger value="contacts" className="gap-2 text-sm">
                  <Users className="w-4 h-4" /> Contactos
                </TabsTrigger>
                <TabsTrigger value="groups" className="gap-2 text-sm">
                  <Users className="w-4 h-4 opacity-60" /> Grupos
                </TabsTrigger>
                <TabsTrigger value="status" className="gap-2 text-sm">
                  <Settings className="w-4 h-4" /> WhatsApp
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="outline-none">
                {loadingContacts ? (
                  <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
                ) : (
                  <ContactsTab contacts={contacts} onReload={loadContacts} showToast={showToast} />
                )}
              </TabsContent>

              <TabsContent value="groups" className="outline-none">
                {loadingGroups ? (
                  <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
                ) : (
                  <GroupsTab
                    groups={groups}
                    onReload={loadGroups}
                    showToast={showToast}
                    backendUrl={backendUrl}
                    botStatus={botStatus}
                  />
                )}
              </TabsContent>

              <TabsContent value="status" className="outline-none">
                <StatusTab botStatus={botStatus} contacts={contacts} onDisconnect={handleDisconnect} onReconnect={handleReconnect} disconnecting={disconnecting} reconnecting={reconnecting} />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* ── Dialog de Historial Dedicado con Buscador ── */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                Historial de Derivaciones
              </DialogTitle>
              <DialogDescription>
                Buscador y registro completo de todos los PDFs enviados.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2 space-y-4">
              {/* Buscador Dedicado */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar por solicitud, subtipo o destinatario..." 
                  value={historySearch} 
                  onChange={(e) => setHistorySearch(e.target.value)} 
                  className="pl-10 h-10 text-sm"
                />
              </div>

              <HistoryTab 
                shipments={filteredShipments} 
                loading={loadingShipments} 
                onReload={loadShipments} 
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Modal de Ayuda / Bienvenida ── */}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto backdrop-blur-xl bg-card/95 border-border/50 shadow-2xl">
            <div className="flex flex-col items-center px-2 py-4 space-y-6 help-container">
              
              <div className="text-center space-y-1.5">
                <h2 className="text-2xl font-black tracking-tight text-foreground uppercase">
                  Bienvenido al PAI
                </h2>
                <p className="text-xs font-extrabold text-primary uppercase tracking-widest">
                  Protocolo de Acción Inmediata · Atención Ciudadana
                </p>
              </div>

              <p className="text-sm text-center text-muted-foreground max-w-xl leading-relaxed">
                Este sistema permite derivar los reclamos del SAC de forma rápida y directa hacia las áreas municipales correspondientes, a través del teléfono de Protocolo por WhatsApp.
              </p>

              <Separator />

              {/* 3-Column horizontal steps layout */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full wizard-steps-grid">
                
                {/* Step 1 */}
                <div className="flex flex-col items-center text-center space-y-3 p-5 rounded-2xl bg-muted/40 border border-border/50 transition-all hover:bg-muted/65 duration-200 wizard-step-card">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black text-base shadow-xs">
                    1
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-sm text-foreground uppercase tracking-wide">1. Descargá el PDF</h3>
                    <p className="text-xs text-muted-foreground leading-normal">
                      Descargá el reclamo desde el SAC en formato PDF en tu computadora.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col items-center text-center space-y-3 p-5 rounded-2xl bg-muted/40 border border-border/50 transition-all hover:bg-muted/65 duration-200 wizard-step-card">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black text-base shadow-xs">
                    2
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-sm text-foreground uppercase tracking-wide">2. Arrastrá el Archivo</h3>
                    <p className="text-xs text-muted-foreground leading-normal">
                      Subilo aquí. El sistema detecta el área y el subtipo del reclamo al instante.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col items-center text-center space-y-3 p-5 rounded-2xl bg-muted/40 border border-border/50 transition-all hover:bg-muted/65 duration-200 wizard-step-card">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black text-base shadow-xs">
                    3
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-sm text-foreground uppercase tracking-wide">3. Confirmá y Enviá</h3>
                    <p className="text-xs text-muted-foreground leading-normal">
                      Elegí el destinatario y presioná enviar. Se despacha directo por WhatsApp.
                    </p>
                  </div>
                </div>

              </div>

              <Separator />

              <div className="text-center space-y-1">
                <p className="text-[11px] text-muted-foreground leading-normal">
                  📌 <strong>Nota del Protocolo:</strong> Una vez enviado, por favor registrá en el SAC que el reclamo ya fue derivado por PAI.
                </p>
                <p className="text-[11px] text-muted-foreground/80 font-medium">
                  Gracias por colaborar en que los reclamos de los vecinos tengan atención inmediata.
                </p>
              </div>

              <Button onClick={() => setHelpOpen(false)} className="w-full max-w-xs h-11 font-bold text-sm rounded-xl mt-2 cursor-pointer transition-all active:scale-95 duration-150">
                Entendido
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {sending && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md animate-fade-in">
            <Card className="w-full max-w-md mx-4 border-2 border-primary/20 shadow-2xl bg-card/90 backdrop-blur-xl animate-scale-in overflow-hidden">
              <CardContent className="p-8 flex flex-col items-center text-center space-y-6">
                
                {progress < 100 ? (
                  // CARGANDO (EN PROCESO DE ENVÍO)
                  <>
                    <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-primary/10 text-primary animate-[pulse_2s_infinite]">
                      <Loader2 className="w-12 h-12 animate-spin text-primary stroke-[2.5]" />
                    </div>

                    <div className="space-y-3 w-full">
                      <h3 className="text-lg font-bold tracking-tight text-foreground uppercase">
                        Enviando Reclamo
                      </h3>
                      
                      {/* Main status */}
                      <p className="text-sm font-semibold text-primary animate-pulse min-h-[20px]">
                        {progressText}
                      </p>

                      {/* Detailed info */}
                      {sendingDetails && (
                        <div className="mt-4 p-4 rounded-xl bg-muted/40 border border-border/50 text-left text-xs space-y-2.5">
                          {sendingDetails.solicitudNro && (
                            <p className="text-foreground/90 font-medium">
                              <span className="text-muted-foreground font-semibold">Solicitud:</span> Nro {sendingDetails.solicitudNro}
                            </p>
                          )}
                          {sendingDetails.subtipo && (
                            <p className="text-foreground/90 font-medium truncate">
                              <span className="text-muted-foreground font-semibold">Subtipo:</span> {sendingDetails.subtipo}
                            </p>
                          )}
                          {sendingDetails.total > 0 && (
                            <div className="flex justify-between items-center pt-2 mt-1 border-t text-[11px]">
                              <span className="text-muted-foreground">Destinatario actual:</span>
                              <span className="font-bold text-foreground truncate max-w-[170px]">
                                {sendingDetails.currentName || 'WhatsApp'}
                              </span>
                            </div>
                          )}
                          {sendingDetails.total > 0 && (
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-muted-foreground">Progreso de contactos:</span>
                              <span className="font-bold text-foreground">
                                {sendingDetails.current} de {sendingDetails.total}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  // COMPLETADO (ÉXITO O PARCIAL / ERROR)
                  <>
                    {/* Visual de estado final */}
                    {(() => {
                      const successCount = sendingDetails?.successCount || 0;
                      const failCount = sendingDetails?.failCount || 0;
                      const totalCount = sendingDetails?.total || 0;

                      if (failCount === 0) {
                        return (
                          <>
                            <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 animate-scale-in">
                              <CheckCircle className="w-14 h-14 stroke-[2]" />
                            </div>
                            <div className="space-y-1.5 w-full">
                              <h3 className="text-xl font-extrabold tracking-tight text-foreground">
                                ¡Envío Completado!
                              </h3>
                              <p className="text-xs text-muted-foreground leading-normal">
                                El reclamo fue derivado exitosamente por WhatsApp a todos los destinatarios seleccionados.
                              </p>
                            </div>
                          </>
                        );
                      } else if (successCount > 0) {
                        return (
                          <>
                            <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 animate-scale-in">
                              <AlertCircle className="w-14 h-14 stroke-[2]" />
                            </div>
                            <div className="space-y-1.5 w-full">
                              <h3 className="text-xl font-extrabold tracking-tight text-foreground">
                                Envío Parcial
                              </h3>
                              <p className="text-xs text-muted-foreground leading-normal">
                                Se envió correctamente a {successCount} de {totalCount} destinatario(s). {failCount} fallaron.
                              </p>
                            </div>
                          </>
                        );
                      } else {
                        return (
                          <>
                            <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-destructive/10 text-destructive animate-scale-in">
                              <X className="w-14 h-14 stroke-[2]" />
                            </div>
                            <div className="space-y-1.5 w-full">
                              <h3 className="text-xl font-extrabold tracking-tight text-foreground">
                                Error de Envío
                              </h3>
                              <p className="text-xs text-muted-foreground leading-normal text-destructive/90">
                                No se pudo entregar la derivación a ningún destinatario. Por favor verificá los números o la conexión.
                              </p>
                            </div>
                          </>
                        );
                      }
                    })()}

                    {/* Cartel de Recordatorio SAC */}
                    {(sendingDetails?.successCount || 0) > 0 && (
                      <div className="w-full p-5 rounded-xl bg-amber-500/10 dark:bg-amber-950/20 border-2 border-amber-500/20 dark:border-amber-900/30 text-center space-y-2 animate-fade-slide-up shadow-sm">
                        <h4 className="text-sm font-extrabold text-amber-800 dark:text-amber-400 tracking-tight leading-snug uppercase">
                          ⚠️ MARCA EN EL SAC QUE ESTE RECLAMO FUE DERIVADO
                        </h4>
                        <p className="text-[11px] text-muted-foreground leading-normal font-medium max-w-xs mx-auto">
                          Recordá registrar que la derivación se realizó por PAI en el sistema SAC para evitar que se envíe dos veces.
                        </p>
                      </div>
                    )}

                    <Button 
                      onClick={handleCloseSending} 
                      className="w-full h-11 font-bold text-sm rounded-xl mt-4 cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground transition-all active:scale-95 duration-150 shadow-sm"
                    >
                      Entendido
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        <SubtypesCatalogDialog
          open={catalogOpen}
          onOpenChange={setCatalogOpen}
          catalog={subtypesCatalog}
          loading={loadingCatalog}
          onReload={loadCatalog}
          showToast={showToast}
          supabase={supabase}
          prefill={catalogPrefill}
          onClearPrefill={() => setCatalogPrefill(null)}
          searchPrefill={catalogSearch}
          onClearSearchPrefill={() => setCatalogSearch('')}
          contacts={contacts}
          onReloadContacts={loadContacts}
          groups={groups}
          onReloadGroups={loadGroups}
        />
      </div>
    </TooltipProvider>
  );
}
