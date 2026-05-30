import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';
import {
  UploadCloud, FileText, Send, Users, Settings, CheckCircle,
  AlertCircle, RefreshCw, X, Trash2, Edit, Save, UserPlus,
  Search, Moon, Sun, Wifi, WifiOff, ChevronLeft,
  Check, Plus, Loader2, Zap, MapPin, ArrowRight,
  History, Clock, ChevronDown, ChevronUp
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

// ── PDF.js worker ──────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// ── Config ─────────────────────────────────────────────────────────────────────
const DEFAULT_SUPABASE_URL = 'https://hltyozdvcqfmvqmyrlva.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdHlvemR2Y3FmbXZxbXlybHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjE5OTEsImV4cCI6MjA5NTYzNzk5MX0.bidc0Iq1-2ztsa6oazqrkt4DJ5b4rBSnIC1PM1E733U';
const DEFAULT_BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3000' : 'https://whatsapp-pdf-bot-backend.onrender.com';
const MAX_RECIPIENTS = 3;

const getParam = (param, def) => {
  const url = new URLSearchParams(window.location.search);
  if (url.has(param)) { localStorage.setItem(param.toUpperCase(), url.get(param)); return url.get(param); }
  return localStorage.getItem(param.toUpperCase()) || def;
};

const supabaseUrl = getParam('supabase_url', DEFAULT_SUPABASE_URL);
const supabaseKey = getParam('supabase_anon_key', DEFAULT_SUPABASE_ANON_KEY);
const backendUrl  = getParam('railway_url', DEFAULT_BACKEND_URL);
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
function DropZone({ onFile, connected, onOpenConfig }) {
  const [active, setActive] = useState(false);
  const inputRef = useRef(null);

  const handleDrag = (e) => {
    if (!connected) return;
    e.preventDefault(); e.stopPropagation();
    setActive(e.type === 'dragenter' || e.type === 'dragover');
  };
  const validate = (file) => {
    if (!connected) return;
    if (file.type !== 'application/pdf') return;
    if (file.size > 52428800) return;
    onFile(file);
  };

  return (
    <div className="animate-fade-slide-up flex flex-col items-center w-full">
      <div
        onDragEnter={handleDrag} onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={(e) => { 
          e.preventDefault(); e.stopPropagation(); 
          if (!connected) return;
          setActive(false); 
          const f = e.dataTransfer.files?.[0]; 
          if (f) validate(f); 
        }}
        onClick={() => {
          if (connected) {
            inputRef.current?.click();
          } else {
            onOpenConfig();
          }
        }}
        className={`dropzone-idle w-full max-w-4xl border-2 border-dashed rounded-3xl cursor-pointer
          flex flex-col items-center justify-center gap-6 py-16 px-8
          transition-all duration-300 select-none
          ${!connected
            ? 'border-muted bg-muted/20 opacity-70 cursor-not-allowed'
            : active 
              ? 'dropzone-active border-primary bg-primary/5 scale-[1.01]' 
              : 'border-border hover:border-primary/50 hover:bg-muted/40'
          }`}
      >
        <input 
          ref={inputRef} 
          type="file" 
          accept="application/pdf" 
          className="hidden"
          disabled={!connected}
          onChange={(e) => e.target.files?.[0] && validate(e.target.files[0])} 
        />
        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center transition-all duration-300 shadow-sm
          ${!connected 
            ? 'bg-red-100 dark:bg-red-950/30 text-red-500'
            : active 
              ? 'bg-primary text-primary-foreground scale-110' 
              : 'bg-muted text-muted-foreground animate-gentle-float'
          }`}
        >
          {connected ? <UploadCloud className="w-10 h-10" /> : <WifiOff className="w-10 h-10 text-red-500 animate-pulse" />}
        </div>
        <div className="text-center space-y-2">
          {connected ? (
            <>
              <p className="text-xl sm:text-2xl font-bold text-foreground">
                {active ? 'Soltá para cargar' : 'Arrastrá acá para enviar por PAI el reclamo...'}
              </p>
              <p className="text-sm sm:text-base text-muted-foreground">o tocá para buscar en tus archivos</p>
              <p className="text-xs text-muted-foreground/50 mt-4">Solo PDF · Máximo 50 MB</p>
            </>
          ) : (
            <>
              <p className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400">
                WhatsApp Desconectado
              </p>
              <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto">
                Para poder enviar reclamos primero debés vincular la sesión de WhatsApp del teléfono de PAI.
              </p>
              <div className="pt-2">
                <Button 
                  onClick={(e) => { e.stopPropagation(); onOpenConfig(); }}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-2.5 rounded-xl shadow-md gap-2"
                >
                  Vincular WhatsApp <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Preview + Contact Picker (split layout) ────────────────────────────
function PreviewAndPick({ file, contacts, onBack, onSend, sending, progress, progressText }) {
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [extracting, setExtracting] = useState(true);
  const [pdfInfo, setPdfInfo] = useState({ areaDestino: null, solicitudNro: null, tipo: null, subtipo: null, ubicacion: null, descripcion: null, fecha: null });
  const [messageText, setMessageText] = useState('');
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  const activeContacts = contacts.filter(c => c.is_active);

  // Create object URL for PDF preview
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Extract PDF info and auto-select matching contact
  useEffect(() => {
    setExtracting(true);
    extractPdfInfo(file).then((info) => {
      setPdfInfo(info);
      setExtracting(false);

      const defaultMsg = `Atención Ciudadana le hace llegar el siguiente reclamo:
*Solicitud Nro:* ${info.solicitudNro || 'No especificado'}

*Subtipo:* ${info.subtipo || 'No especificado'}

*Ubicación:* ${info.ubicacion || 'No especificada'}

*Descripción:* ${info.descripcion || 'No especificado'}

Este reclamo fue cargado en el SAC el ${info.fecha || 'No especificada'}`;
      setMessageText(defaultMsg);

      if (info.areaDestino) {
        const normalized = info.areaDestino.toLowerCase().trim();
        const match = activeContacts.find(c =>
          c.area_destino && c.area_destino.toLowerCase().trim() === normalized
        );
        if (match) setSelected(new Set([match.id]));
      }
    });
  }, [file]);

  const filtered = activeContacts.filter(c => {
    const isAutoDetected = pdfInfo.areaDestino &&
      c.area_destino?.toLowerCase().trim() === pdfInfo.areaDestino.toLowerCase().trim();
    if (search.trim() === '') {
      return isAutoDetected;
    }
    return c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.area_destino || '').toLowerCase().includes(search.toLowerCase());
  });

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_RECIPIENTS) return prev; // max 3
        next.add(id);
      }
      return next;
    });
  };

  const handleSend = () => {
    const recipients = contacts.filter(c => selected.has(c.id));
    onSend(recipients, pdfInfo, messageText);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (sending) return;
      if (e.key === 'Enter' && selected.size > 0) {
        e.preventDefault();
        handleSend();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, sending, onBack]);

  return (
    <div className="animate-fade-slide-up w-full">
      {/* PDF info banner */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {extracting ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Analizando documento...
          </div>
        ) : (
          <>

            {pdfInfo.areaDestino && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-sm font-semibold text-primary">
                <MapPin className="w-3.5 h-3.5" />
                Área detectada: {pdfInfo.areaDestino}
              </div>
            )}
          </>
        )}
      </div>

      {/* Split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[750px]">

        {/* LEFT: PDF Preview */}
        <div className="rounded-2xl overflow-hidden border bg-muted flex flex-col">
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-card border-b">
            <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{file.name}</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <button onClick={onBack} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
          {pdfUrl ? (
            <embed
              src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
              type="application/pdf"
              className="flex-1 w-full min-h-[700px]"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* RIGHT: Contact Picker */}
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between border-b pb-2 mb-1">
            <div className="space-y-1">
              <h3 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground leading-none">
                ¿A quién enviás?
              </h3>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                Máximo {MAX_RECIPIENTS} destinatarios · {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
              </p>
            </div>
            {selected.size >= MAX_RECIPIENTS && (
              <Badge variant="destructive" className="text-xs font-bold shadow-sm">Límite alcanzado</Badge>
            )}
          </div>

          {/* Message Preview / Editor */}
          <div className="rounded-xl border border-primary/10 bg-primary/[0.01] dark:bg-primary/[0.02] p-4 space-y-2.5 relative shadow-sm hover:shadow transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary dark:text-primary-foreground uppercase tracking-wider">
                Mensaje de WhatsApp
              </span>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setIsEditingMessage(!isEditingMessage)}
              >
                {isEditingMessage ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Edit className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {isEditingMessage ? (
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                className="w-full min-h-[140px] text-xs font-medium bg-card text-foreground border rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-primary shadow-inner"
              />
            ) : (
              <div className="text-xs bg-card border rounded-lg p-2.5 font-medium whitespace-pre-wrap leading-relaxed text-muted-foreground min-h-[140px] overflow-y-auto max-h-[180px] shadow-inner">
                {messageText}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar..." value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-10 h-10 text-sm" />
          </div>

          {/* Contacts list */}
          <ScrollArea className="h-[280px] rounded-2xl border bg-card/60 dark:bg-card/20 shadow-inner">
            <div className="p-2 space-y-1">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  {search.trim() === '' ? 'Escribí en el buscador para encontrar destinatarios...' : 'Sin destinatarios'}
                </div>
              ) : filtered.map(c => {
                const isSelected = selected.has(c.id);
                const isAutoDetected = pdfInfo.areaDestino &&
                  c.area_destino?.toLowerCase().trim() === pdfInfo.areaDestino.toLowerCase().trim();
                const isDisabled = !isSelected && selected.size >= MAX_RECIPIENTS;

                return (
                  <div
                    key={c.id}
                    onClick={() => !isDisabled && toggle(c.id)}
                    className={`contact-card flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200
                      ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                      ${isSelected
                        ? 'bg-primary/10 border border-primary/25'
                        : isAutoDetected
                          ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                          : 'hover:bg-muted/60 border border-transparent'
                      }`}
                  >
                    <Checkbox checked={isSelected} disabled={isDisabled}
                      onCheckedChange={() => !isDisabled && toggle(c.id)}
                      onClick={(e) => e.stopPropagation()} className="flex-shrink-0" />
                    <Avatar className="flex-shrink-0 w-9 h-9">
                      <AvatarFallback className={`text-xs font-bold
                        ${isSelected ? 'bg-primary text-primary-foreground' :
                          isAutoDetected ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200' :
                          'bg-muted text-muted-foreground'}`}>
                        {initials(c.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                        {isAutoDetected && (
                          <Badge className="text-[9px] h-4 px-1.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 border-0">
                            <Zap className="w-2.5 h-2.5 mr-0.5" />Auto
                          </Badge>
                        )}
                      </div>
                      {c.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{c.description}</p>
                      )}
                      {c.area_destino && (
                        <p className="text-[10px] text-primary/70 truncate mt-0.5 flex items-center gap-1">
                          <MapPin className="w-2.5 h-2.5" />{c.area_destino}
                        </p>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          </ScrollArea>


          {/* Buttons */}
          <div className="flex gap-3">
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
  const [form, setForm] = useState({ name: '', phone: '', description: '', area_destino: '' });
  const [editForm, setEditForm] = useState({ name: '', phone_number: '', description: '', area_destino: '' });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const filtered = search.trim() === '' ? [] : contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.area_destino || '').toLowerCase().includes(search.toLowerCase()) ||
    c.phone_number.includes(search)
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
    try {
      const { error } = await supabase.from('contacts').insert([{
        name: form.name.trim(), phone_number: normalizePhone(form.phone),
        description: form.description.trim() || null,
        area_destino: form.area_destino.trim() || null,
        is_active: true,
      }]);
      if (error) throw error;
      showToast('Contacto agregado ✓');
      setForm({ name: '', phone: '', description: '', area_destino: '' });
      setAddOpen(false); onReload();
    } catch (err) {
      showToast(err.message.includes('23505') ? 'Ese número ya existe' : err.message, 'error');
    } finally { setSaving(false); }
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { showToast('El nombre es obligatorio', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('contacts').update({
        name: editForm.name.trim(), phone_number: normalizePhone(editForm.phone_number),
        description: editForm.description?.trim() || null,
        area_destino: editForm.area_destino?.trim() || null,
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
    setEditForm({ name: c.name, phone_number: c.phone_number, description: c.description || '', area_destino: c.area_destino || '' });
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
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <Input value={editForm.name} onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Nombre" className="h-8 text-sm col-span-2" />
                    <Input value={editForm.phone_number} onChange={(e) => setEditForm(p => ({ ...p, phone_number: e.target.value }))}
                      placeholder="Teléfono" className="h-8 text-sm font-mono" />
                    <Input value={editForm.area_destino} onChange={(e) => setEditForm(p => ({ ...p, area_destino: e.target.value }))}
                      placeholder="Área destino (ej: ATENCIÓN CIUDADANA)" className="h-8 text-sm" />
                    <Input value={editForm.description} onChange={(e) => setEditForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="Descripción / apodo" className="h-8 text-sm col-span-2" />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                      {!c.is_active && <Badge variant="outline" className="text-[10px] h-4 py-0">Inactivo</Badge>}
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{c.description}</p>}
                    {c.area_destino && (
                      <p className="text-[10px] text-primary/70 truncate mt-0.5 flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5" />{c.area_destino}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1 flex-shrink-0">
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
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(c.id)}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Nuevo Contacto</DialogTitle>
            <DialogDescription>Completá los datos del destinatario</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-sm font-medium">Nombre *</Label>
              <Input id="add-name" placeholder="Ej. Mesa de Entradas"
                value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone" className="text-sm font-medium">Teléfono *</Label>
              <Input id="add-phone" placeholder="Ej. 549342555555" className="font-mono"
                value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Con código de país: 549 + área + número</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-area" className="text-sm font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                Área destino <span className="text-muted-foreground font-normal">(para detección automática)</span>
              </Label>
              <Input id="add-area" placeholder="Ej. ATENCIÓN CIUDADANA"
                value={form.area_destino} onChange={(e) => setForm(p => ({ ...p, area_destino: e.target.value }))} />
              <p className="text-xs text-muted-foreground">Debe coincidir exactamente con el campo "Area destino" del PDF</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-desc" className="text-sm font-medium">Descripción <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Input id="add-desc" placeholder="Ej. Coordinador de Atención al Vecino"
                value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} />
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

// ── Status Tab ─────────────────────────────────────────────────────────────────
function StatusTab({ botStatus, contacts, onDisconnect, disconnecting }) {
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
        <Card className="border-red-200 dark:border-red-900 bg-red-500/[0.02]">
          <CardHeader className="text-center pb-4">
            <Badge variant="destructive" className="mx-auto mb-2 text-[10px] font-black uppercase tracking-wider animate-pulse px-3 py-1 bg-red-600 text-white">
              ⚠️ VINCULACIÓN REQUERIDA
            </Badge>
            <CardTitle className="text-base font-black text-red-600 dark:text-red-400 leading-tight">
              ESCANEA EL QR CON EL CELULAR DEL PAI PARA CONECTARTE
            </CardTitle>
            <CardDescription className="text-xs font-semibold mt-1">
              Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            {botStatus.qr ? (
              <div className="p-3 bg-white rounded-2xl shadow-md border">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(botStatus.qr)}&size=200x200`} alt="QR" className="w-48 h-48 rounded-lg" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Generando código QR...</p>
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
  const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
  
  return (
    <div className="border rounded-xl p-4 bg-card hover:bg-accent/30 transition-colors shadow-sm duration-200">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            {item.status === 'success' ? (
              <CheckCircle className="w-5 h-5 text-emerald-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-destructive" />
            )}
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.subtipo && (
                <Badge variant="outline" className="text-xs font-semibold px-2 py-0 bg-secondary/50">
                  {item.subtipo}
                </Badge>
              )}
              {item.solicitud_nro && (
                <span className="text-xs text-muted-foreground font-mono">
                  Sol. Nro: <strong className="text-foreground">{item.solicitud_nro}</strong>
                </span>
              )}
            </div>
            <p className="text-sm font-bold text-foreground">
              {item.contact_name}
              <span className="text-xs font-normal text-muted-foreground ml-1.5">
                (+{item.contact_phone})
              </span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
          <Clock className="w-3.5 h-3.5" />
          <span>{timeStr}</span>
        </div>
      </div>
      
      {item.message_text && (
        <div className="mt-3 pt-3 border-t">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline transition-all"
          >
            {expanded ? (
              <>Ocultar mensaje <ChevronUp className="w-3 h-3" /></>
            ) : (
              <>Ver mensaje enviado <ChevronDown className="w-3 h-3" /></>
            )}
          </button>
          {expanded && (
            <div className="mt-2 p-3 bg-muted/40 border rounded-lg text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed animate-fade-slide-up">
              {item.message_text}
            </div>
          )}
        </div>
      )}
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
    <div className="animate-fade-slide-up space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold">Historial de Envíos</h3>
          <p className="text-xs text-muted-foreground">Registro de todos los PDFs enviados y su estado.</p>
        </div>
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
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : shipments.length === 0 ? (
        <Card className="border-dashed py-12 text-center">
          <CardContent className="flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <History className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-muted-foreground">No hay envíos registrados</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Los documentos PDF que envíes a través de esta plataforma aparecerán aquí agrupados por día.
            </p>
          </CardContent>
        </Card>
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
  const [botStatus, setBotStatus] = useState({ connected: false, checking: true, qr: null, offline: true, phoneUser: null });
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('send');
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [sendingDetails, setSendingDetails] = useState(null);
  
  const [shipments, setShipments] = useState([]);
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleOpenConfig = () => {
    setConfigTab(botStatus.connected ? 'contacts' : 'status');
    setConfigOpen(true);
  };

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

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

  useEffect(() => {
    if (configOpen && configTab === 'history') {
      loadShipments();
    }
  }, [configOpen, configTab, loadShipments]);

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
    loadShipments();
  }, [loadContacts, loadShipments]);

  useEffect(() => {
    let failedCount = 0;
    const check = async () => {
      try {
        const res = await fetch(`${backendUrl}/status`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        failedCount = 0;
        setBotStatus({ connected: !!data.connected, checking: false, qr: data.qr || null, offline: false, phoneUser: data.phone_user || null });
      } catch {
        failedCount++;
        if (failedCount >= 3) {
          setBotStatus({ connected: false, checking: false, qr: null, offline: true, phoneUser: null });
        }
      }
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

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
      
      // Auto-asociación del área destino detectada para todos los contactos seleccionados
      if (areaDestino) {
        setProgress(30);
        setProgressText('Guardando áreas predeterminadas...');
        setSendingDetails(prev => ({ ...prev, currentName: 'Base de Datos' }));
        const cleanArea = areaDestino.trim();
        for (const contact of recipients) {
          if (contact.area_destino !== cleanArea) {
            try {
              await supabase.from('contacts').update({ area_destino: cleanArea }).eq('id', contact.id);
            } catch (dbErr) {
              console.error("Error al guardar area_destino:", dbErr);
            }
          }
        }
        await loadContacts();
      }

      setProgress(50);
      const results = [];
      for (const [i, contact] of recipients.entries()) {
        setProgressText(`Enviando a ${contact.name}... (${i + 1}/${recipients.length})`);
        setSendingDetails(prev => ({
          ...prev,
          current: i + 1,
          currentName: contact.name
        }));
        try {
          const res = await fetch(`${backendUrl}/send-pdf`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: uniqueName,
              phoneNumber: contact.phone_number,
              caption: messageText,
              contactName: contact.name,
              solicitudNro: pdfInfo?.solicitudNro,
              subtipo: pdfInfo?.subtipo,
              displayName: displayName
            }),
          });
          const result = await res.json();
          results.push({ ok: res.ok && result.success });
        } catch { results.push({ ok: false }); }
        setProgress(50 + Math.round(((i + 1) / recipients.length) * 50));
      }
      const ok = results.filter(r => r.ok).length;
      const fail = results.length - ok;
      setProgress(100);
      if (fail === 0) showToast(`¡Enviado a ${ok} destinatario${ok > 1 ? 's' : ''}! ✓`);
      else showToast(`${ok} enviado${ok !== 1 ? 's' : ''}, ${fail} falló`, 'error');
      
      // Actualizar historial
      loadShipments();

      setTimeout(() => {
        setFile(null);
        setStep(0);
        setSending(false);
        setProgress(0);
        setProgressText('');
        setSendingDetails(null);
      }, 2500);
    } catch (err) {
      showToast(err.message, 'error');
      setSending(false);
      setProgress(0);
      setSendingDetails(null);
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground flex flex-col">

        {/* ── Cabecera simplificada y adaptada para Google Sites ── */}
        <div className="max-w-6xl mx-auto w-full px-4 pt-6 pb-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground leading-none">
              Protocolo de Acción Inmediata
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-muted-foreground mt-1">
              Derivaciones · Atención Ciudadana
            </p>
          </div>
          <div className="flex items-center gap-3">

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} className="h-9 w-9">
                    {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{dark ? 'Modo claro' : 'Modo oscuro'}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant={botStatus.connected ? "outline" : "default"} 
                    size="icon" 
                    onClick={handleOpenConfig} 
                    className={`h-9 w-9 ${!botStatus.connected ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse ring-2 ring-red-500/25' : ''}`}
                  >
                    <Settings className={`w-4 h-4 ${botStatus.connected ? 'text-muted-foreground hover:text-foreground' : 'text-white'}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Configurar Destinatarios y Estado</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* ── Main content (solo el flujo de envío de 2 pasos) ── */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
          {step === 0 && (
            <div className="flex flex-col items-center gap-6 w-full">
              <DropZone 
                onFile={(f) => { setFile(f); setStep(1); }} 
                connected={botStatus.connected}
                onOpenConfig={handleOpenConfig}
              />
            </div>
          )}
          {step === 1 && file && (
            <PreviewAndPick
              file={file} contacts={loadingContacts ? [] : contacts}
              onBack={() => { setFile(null); setStep(0); }}
              onSend={handleSend} sending={sending}
              progress={progress} progressText={progressText}
            />
          )}

          {/* Mini Historial de Envíos en tiempo real */}
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
              <div className="grid grid-cols-1 gap-3">
                {shipments.slice(0, 5).map((item) => {
                  const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
                  const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
                  
                  return (
                    <div 
                      key={item.id} 
                      className="flex items-center justify-between gap-3 p-4 border rounded-xl bg-card hover:bg-accent/20 transition-colors duration-200 text-xs shadow-sm animate-fade-slide-up"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {item.status === 'success' ? (
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-destructive flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.solicitud_nro && (
                              <span className="font-bold text-foreground font-mono">
                                Sol. Nro {item.solicitud_nro}
                              </span>
                            )}
                            {item.subtipo && (
                              <Badge variant="outline" className="text-[10px] font-semibold px-1.5 py-0 bg-secondary/50">
                                {item.subtipo}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1 truncate">
                            Para: <strong className="text-foreground">{item.contact_name}</strong> (+{item.contact_phone})
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 text-muted-foreground font-mono text-[10px] space-y-0.5">
                        <p className="font-semibold text-foreground">{dateStr}</p>
                        <p>{timeStr}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        <footer className="border-t py-4 text-center text-xs text-muted-foreground">
          Municipalidad de Santa Fe © {new Date().getFullYear()} · Atención Ciudadana
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
                <TabsTrigger value="status" className="gap-2 text-sm">
                  <Settings className="w-4 h-4" /> Estado de WhatsApp
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-2 text-sm">
                  <History className="w-4 h-4" /> Historial
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts" className="outline-none">
                {loadingContacts ? (
                  <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
                ) : (
                  <ContactsTab contacts={contacts} onReload={loadContacts} showToast={showToast} />
                )}
              </TabsContent>

              <TabsContent value="status" className="outline-none">
                <StatusTab botStatus={botStatus} contacts={contacts} onDisconnect={handleDisconnect} disconnecting={disconnecting} />
              </TabsContent>

              <TabsContent value="history" className="outline-none">
                <HistoryTab shipments={shipments} loading={loadingShipments} onReload={loadShipments} />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {sending && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md animate-fade-in">
            <Card className="w-full max-w-md mx-4 border-2 border-primary/20 shadow-2xl bg-card/90 backdrop-blur-xl animate-scale-in overflow-hidden">
              <CardContent className="p-8 flex flex-col items-center text-center space-y-6">
                
                {/* Circular progress container */}
                <div className="relative w-28 h-28 flex items-center justify-center">
                  {/* SVG Ring Progress */}
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      className="stroke-muted fill-none"
                      strokeWidth="8"
                    />
                    <circle
                      cx="56"
                      cy="56"
                      r="48"
                      className="stroke-primary fill-none transition-all duration-300 ease-out"
                      strokeWidth="8"
                      strokeDasharray={2 * Math.PI * 48}
                      strokeDashoffset={2 * Math.PI * 48 * (1 - progress / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  {/* Inner text or icon */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {progress === 100 ? (
                      <CheckCircle className="w-12 h-12 text-emerald-500 animate-bounce" />
                    ) : (
                      <span className="text-2xl font-black text-foreground font-mono">{progress}%</span>
                    )}
                  </div>
                </div>

                <div className="space-y-2 w-full">
                  <h3 className="text-xl font-bold tracking-tight text-foreground">
                    {progress === 100 ? '¡Envío Completado!' : 'Enviando Reclamo...'}
                  </h3>
                  
                  {/* Main status */}
                  <p className="text-sm font-semibold text-primary animate-pulse">
                    {progressText}
                  </p>

                  {/* Detailed info */}
                  {sendingDetails && (
                    <div className="mt-4 p-4 rounded-xl bg-muted/50 border text-left text-xs space-y-2">
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
                          <span className="font-bold text-foreground truncate max-w-[150px]">
                            {sendingDetails.currentName || 'WhatsApp'}
                          </span>
                        </div>
                      )}
                      {sendingDetails.total > 0 && (
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-muted-foreground">Progreso de contactos:</span>
                          <span className="font-bold text-foreground">
                            {sendingDetails.current} / {sendingDetails.total}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </TooltipProvider>
  );
}
