import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Users, UserCheck, UserMinus, Phone, UploadCloud, FileText, 
  Trash2, Edit, Save, Plus, Search, RefreshCw, X, CheckCircle, 
  AlertCircle, ChevronRight, UserPlus, Info, Check, MessageSquare
} from 'lucide-react';

// shadcn UI imports
import { Button } from "@/components/ui/button";
import { 
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle 
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";

// ==========================================
// CONFIGURACIÓN POR DEFECTO
// ==========================================
const DEFAULT_SUPABASE_URL = "https://hltyozdvcqfmvqmyrlva.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdHlvemR2Y3FmbXZxbXlybHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjE5OTEsImV4cCI6MjA5NTYzNzk5MX0.bidc0Iq1-2ztsa6oazqrkt4DJ5b4rBSnIC1PM1E733U";
const DEFAULT_BACKEND_URL = "https://whatsapp-pdf-bot-backend.onrender.com";

// Cargamos de URL query string o localStorage con fallbacks seguros
const getQueryOrStorageParam = (param, defaultValue) => {
  const urlParams = new URLSearchParams(window.location.search);
  const upperParam = param.toUpperCase();
  if (urlParams.has(param)) {
    const val = urlParams.get(param);
    localStorage.setItem(upperParam, val);
    return val;
  }
  return localStorage.getItem(upperParam) || defaultValue;
};

const supabaseUrl = getQueryOrStorageParam('supabase_url', DEFAULT_SUPABASE_URL);
const supabaseKey = getQueryOrStorageParam('supabase_anon_key', DEFAULT_SUPABASE_ANON_KEY);
const backendUrl = getQueryOrStorageParam('railway_url', DEFAULT_BACKEND_URL);

// Inicializamos el cliente de Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

export default function App() {
  // --- Estados Principales ---
  const [lightMode, setLightMode] = useState(false);
  const [botStatus, setBotStatus] = useState({ connected: false, checking: true, qr: null, offline: true, phoneUser: null });
  const [contacts, setContacts] = useState([]);
  const [filteredContacts, setFilteredContacts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // --- Estados de Formulario de Envío ---
  const [selectedContact, setSelectedContact] = useState(null);
  const [customPhone, setCustomPhone] = useState('');
  const [phoneSearchText, setPhoneSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  
  // --- Estados de Envío (Progreso) ---
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  
  // --- Estados de Gestión de Contactos ---
  const [modalOpen, setModalOpen] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  const [newContact, setNewContact] = useState({ name: '', phone: '' });
  const [editingContactId, setEditingContactId] = useState(null);
  const [editingValues, setEditingValues] = useState({ name: '', phone_number: '' });
  
  // --- Estado de Notificaciones Toast ---
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const dropdownRef = useRef(null);

  // --- Efecto: Polling de Estado del Servidor ---
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${backendUrl}/status`);
        if (!res.ok) throw new Error('Servidor fuera de línea');
        const data = await res.json();
        setBotStatus({
          connected: !!data.connected,
          checking: false,
          qr: data.qr || null,
          offline: false,
          phoneUser: data.phone_user || null
        });
      } catch (err) {
        setBotStatus({
          connected: false,
          checking: false,
          qr: null,
          offline: true,
          phoneUser: null
        });
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // --- Efecto: Carga Inicial de Contactos ---
  useEffect(() => {
    loadContacts();
  }, []);

  // --- Cerrar dropdown al hacer click afuera ---
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- Cargar contactos desde Supabase ---
  const loadContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('name', { ascending: true });
      
      if (error) throw error;
      setContacts(data || []);
      setFilteredContacts(data || []);
    } catch (err) {
      showToast('Error cargando contactos: ' + err.message, 'error');
    }
  };

  // --- Filtrar contactos para el buscador principal ---
  useEffect(() => {
    const query = phoneSearchText.toLowerCase().trim();
    if (!query) {
      setFilteredContacts(contacts.filter(c => c.is_active));
      return;
    }

    const filtered = contacts.filter(c => 
      c.is_active && 
      (c.name.toLowerCase().includes(query) || c.phone_number.includes(query))
    );
    setFilteredContacts(filtered);
  }, [phoneSearchText, contacts]);

  // --- Notificación Toast ---
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  // --- Manejo de Drag & Drop ---
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndSetFile(file);
    }
  };

  const validateAndSetFile = (file) => {
    if (file.type !== "application/pdf") {
      showToast("Por favor, selecciona únicamente archivos PDF.", "error");
      return;
    }
    if (file.size > 52428800) { // 50MB
      showToast("El archivo excede el tamaño máximo permitido de 50MB.", "error");
      return;
    }
    setSelectedFile(file);
  };

  // --- Procesar y Enviar Archivo ---
  const handleSendFile = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    // Obtener número telefónico limpio
    let phoneToUse = '';
    if (selectedContact) {
      phoneToUse = selectedContact.phone_number;
    } else {
      phoneToUse = customPhone.replace(/\D/g, '');
    }

    if (!phoneToUse || phoneToUse.length < 8) {
      showToast("Por favor, introduce un número de teléfono válido de al menos 8 dígitos.", "error");
      return;
    }

    // Normalizar números argentinos
    if (phoneToUse.length === 10 && /^[123]/.test(phoneToUse)) {
      phoneToUse = '549' + phoneToUse;
    } else if (phoneToUse.length === 12 && phoneToUse.startsWith('54') && phoneToUse[2] !== '9') {
      phoneToUse = '549' + phoneToUse.substring(2);
    }

    setUploading(true);
    setUploadProgress(10);
    setProgressText('Preparando archivo para la subida...');

    // Generar nombre de archivo único
    const fileExtension = selectedFile.name.split('.').pop();
    const cleanFileName = selectedFile.name.replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueFileName = `${Date.now()}_${cleanFileName}.${fileExtension}`;

    try {
      setUploadProgress(30);
      setProgressText('Subiendo PDF a Supabase Storage...');

      // Subida directa al bucket de Supabase
      const { data, error: uploadError } = await supabase.storage
        .from('pdfs')
        .upload(uniqueFileName, selectedFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      setUploadProgress(70);
      setProgressText('Notificando a la pasarela de WhatsApp...');

      // Notificar al backend de envío de WhatsApp
      const res = await fetch(`${backendUrl}/send-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileName: uniqueFileName,
          phoneNumber: phoneToUse
        })
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.message || 'Error al procesar el envío en el backend.');
      }

      setUploadProgress(100);
      setProgressText('¡Completado con éxito!');
      showToast("¡Archivo enviado exitosamente por WhatsApp!", "success");
      
      setTimeout(() => {
        setSelectedFile(null);
        setUploading(false);
        setUploadProgress(0);
        setProgressText('');
      }, 2000);

    } catch (err) {
      showToast(err.message, 'error');
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // --- Gestión de Contactos: Operaciones ---
  const handleCreateContact = async (e) => {
    e.preventDefault();
    const nameVal = newContact.name.trim();
    let phoneVal = newContact.phone.replace(/\D/g, '');

    if (!nameVal || phoneVal.length < 8) {
      showToast("Completa los datos con un teléfono de al menos 8 dígitos.", "error");
      return;
    }

    if (phoneVal.length === 10 && /^[123]/.test(phoneVal)) {
      phoneVal = '549' + phoneVal;
    } else if (phoneVal.length === 12 && phoneVal.startsWith('54') && phoneVal[2] !== '9') {
      phoneVal = '549' + phoneVal.substring(2);
    }

    try {
      const { error } = await supabase
        .from('contacts')
        .insert([{ name: nameVal, phone_number: phoneVal, is_active: true }]);

      if (error) {
        if (error.code === '23505') throw new Error("El número de teléfono ya existe en el sistema.");
        throw error;
      }

      showToast("Contacto agregado exitosamente.");
      setNewContact({ name: '', phone: '' });
      loadContacts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleContactActive = async (id, currentVal) => {
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ is_active: !currentVal })
        .eq('id', id);

      if (error) throw error;
      
      setContacts(prev => prev.map(c => c.id === id ? { ...c, is_active: !currentVal } : c));
    } catch (err) {
      showToast("Error al modificar estado: " + err.message, "error");
    }
  };

  const handleDeleteContact = async (id) => {
    if (!confirm("¿Estás seguro de que deseas eliminar este contacto de forma permanente?")) return;
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showToast("Contacto eliminado.");
      setContacts(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      showToast("Error al eliminar: " + err.message, "error");
    }
  };

  const startEditContact = (c) => {
    setEditingContactId(c.id);
    setEditingValues({ name: c.name, phone_number: c.phone_number });
  };

  const saveEditContact = async (id) => {
    const nameVal = editingValues.name.trim();
    const phoneVal = editingValues.phone_number.replace(/\D/g, '');

    if (!nameVal || !phoneVal) {
      showToast("Nombre y teléfono obligatorios", "error");
      return;
    }

    try {
      const { error } = await supabase
        .from('contacts')
        .update({ name: nameVal, phone_number: phoneVal })
        .eq('id', id);

      if (error) throw error;

      showToast("Contacto actualizado.");
      setEditingContactId(null);
      loadContacts();
    } catch (err) {
      showToast("Error al guardar cambios: " + err.message, "error");
    }
  };

  // --- Estadísticas ---
  const activeContactsCount = contacts.filter(c => c.is_active).length;

  return (
    <div className={`min-h-screen flex flex-col justify-between relative ${lightMode ? "bg-white text-gray-900" : "bg-slate-950 text-slate-100"} font-sans antialiased`}>
      
      {/* Luces de Fondo (Glows) */}
      <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none z-0"></div>
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-emerald-600/10 rounded-full blur-[140px] pointer-events-none z-0"></div>

      {/* HEADER PREMIUM */}
      <header className="w-full max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between border-b border-slate-900 gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="h-12 flex items-center justify-center p-1.5 bg-slate-950 border border-slate-800 rounded-xl shadow-lg">
            {/* Logo de la municipalidad de Santa Fe cargado dinámicamente */}
            <img 
              src="/marca_muni/SF_Horizontal_Blanco.png" 
              alt="Logo Santa Fe" 
              className="h-9 object-contain" 
              onError={(e) => {
                // Fallback si no carga la imagen
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div className="h-8 w-[1px] bg-slate-800 hidden sm:block"></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Portal de Automatización
            </h1>
            <p className="text-xs text-emerald-400 font-semibold tracking-wider uppercase">Santa Fe Ciudad</p>
          </div>
        </div>

        {/* Indicadores y Menú */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Theme toggle button */}
          <Button variant="outline" size="sm" onClick={() => setLightMode(!lightMode)} className="ml-4">{lightMode ? 'Oscuro' : 'Claro'}</Button>
          {/* Bot Connection Status */}
          <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full border text-xs font-semibold shadow-md transition-all duration-300 ${
            botStatus.offline 
              ? 'bg-slate-900 border-slate-800 text-slate-500' 
              : botStatus.connected 
                ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400 glow-green' 
                : 'bg-red-950/20 border-red-900/30 text-red-400 glow-red'
          }`}>
            <span className={`w-2.5 h-2.5 rounded-full ${
              botStatus.offline 
                ? 'bg-slate-700' 
                : botStatus.connected 
                  ? 'bg-emerald-500 animate-pulse' 
                  : 'bg-red-500 animate-pulse'
            }`}></span>
            <span>
              {botStatus.offline 
                ? 'Backend Fuera de Línea' 
                : botStatus.connected 
                  ? `WhatsApp Conectado ${botStatus.phoneUser ? `(${botStatus.phoneUser.split('@')[0]})` : ''}` 
                  : 'Escáner de Código QR Requerido'}
            </span>
          </div>

          {/* Botón Gestión de Contactos */}
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setModalOpen(true)}
            className="rounded-full bg-slate-900/80 hover:bg-slate-800 border-slate-800 text-xs font-semibold gap-2 transition-all duration-200 h-9"
          >
            <Users className="w-4 h-4 text-indigo-400" />
            Contactos ({contacts.length})
          </Button>
        </div>
      </header>

      {/* CUERPO PRINCIPAL */}
      <main className="flex-grow flex items-center justify-center p-6 relative z-10 w-full max-w-7xl mx-auto">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Columna Izquierda: Información de Conexión y Estadísticas */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Tarjeta de Estadísticas Rápidas */}
            <Card className="glass border-slate-900 shadow-xl overflow-hidden rounded-2xl">
              <CardHeader className="pb-3 border-b border-slate-900/50">
                <CardTitle className="text-md font-bold text-slate-100 flex items-center gap-2">
                  <Info className="w-4.5 h-4.5 text-indigo-400" />
                  Estado del Sistema
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">Métricas y conexiones activas</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-2 gap-4">
                <div className="bg-slate-900/40 p-3.5 rounded-xl border border-slate-900 text-center">
                  <div className="text-2xl font-extrabold text-indigo-400">{contacts.length}</div>
                  <div className="text-[10px] uppercase font-semibold text-slate-500 mt-1">Total Contactos</div>
                </div>
                <div className="bg-slate-900/40 p-3.5 rounded-xl border border-slate-900 text-center">
                  <div className="text-2xl font-extrabold text-emerald-400">{activeContactsCount}</div>
                  <div className="text-[10px] uppercase font-semibold text-slate-500 mt-1">Contactos Activos</div>
                </div>
              </CardContent>
              <CardFooter className="bg-slate-950/40 py-3 text-[10px] text-slate-500 flex justify-between border-t border-slate-900/50">
                <span>Servidor: Hugging Face Spaces</span>
                 <span className="text-slate-400 font-semibold">Servicio</span>
              </CardFooter>
            </Card>

            {/* Código QR si WhatsApp está desconectado */}
            {!botStatus.connected && !botStatus.offline && (
              <Card className="glass border-red-900/20 glow-red rounded-2xl overflow-hidden">
                <CardHeader className="text-center">
                  <CardTitle className="text-md font-bold text-red-400 flex items-center justify-center gap-2">
                    <AlertCircle className="w-5 h-5 animate-pulse" />
                    Enlace de Dispositivo
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    Escanea el código QR con WhatsApp Business (Dispositivos Vinculados) para conectar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center p-6 bg-slate-900/20 border-t border-slate-900/50">
                  {botStatus.qr ? (
                    <div className="p-3 bg-white rounded-xl shadow-lg border border-slate-200">
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(botStatus.qr)}&size=200x200&color=0f172a&bgcolor=ffffff`}
                        alt="Código QR de WhatsApp" 
                        className="w-48 h-48 rounded"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-10 space-y-3">
                      <RefreshCw className="animate-spin h-8 w-8 text-red-500" />
                      <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">Esperando código QR...</span>
                    </div>
                  )}
                  <span className="text-[10px] text-slate-500 mt-4 text-center">El QR se refresca periódicamente de forma automática.</span>
                </CardContent>
              </Card>
            )}

            {/* Si el servidor está caído */}
            {botStatus.offline && (
              <Card className="glass border-red-900/40 glow-red rounded-2xl overflow-hidden">
                <CardHeader className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3 animate-bounce" />
                  <CardTitle className="text-md font-bold text-red-400">
                    Servidor Fuera de Línea
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400 mt-2">
                    No pudimos establecer conexión con el backend. Esperando que despierte del estado de hibernación o de inicio.
                  </CardDescription>
                </CardHeader>
                <CardContent className="bg-slate-900/20 py-4 text-center border-t border-slate-900/50">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-900 text-xs text-slate-400 font-medium">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-500" />
                    Reintentando conexión...
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Mini banner municipal con identidad visual */}
            <div className="p-5 rounded-2xl glass border-slate-900 bg-gradient-to-tr from-slate-950/90 to-indigo-950/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl"></div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400">Manual de Envío</h4>
              <ul className="text-xs text-slate-400 mt-3 space-y-2 list-disc pl-4">
                <li>Selecciona el contacto de la lista activa.</li>
                <li>Sube el documento PDF (hasta 50 MB de peso).</li>
                <li>El sistema subirá el archivo y le enviará el mensaje directo de WhatsApp de inmediato.</li>
              </ul>
            </div>

          </div>

          {/* Columna Derecha: Formulario de Carga y Envío */}
          <div className="lg:col-span-8">
            <Card className="glass border-slate-900 shadow-2xl rounded-3xl overflow-hidden glow-indigo">
              <CardHeader className="border-b border-slate-900 bg-slate-950/40 py-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-white tracking-tight">Enviar Documento PDF</CardTitle>
                    <CardDescription className="text-xs text-slate-400 mt-1">
                      Envío automatizado a través de WhatsApp Business con almacenamiento en la nube de Supabase.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-indigo-950/20 border-indigo-900/30 text-indigo-400 h-6">
                    Muni-PDF Gateway v2.0
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="p-8 space-y-6">
                <form onSubmit={handleSendFile} className="space-y-6">
                  
                  {/* Selector de Contacto de Destino */}
                  <div className="space-y-2.5 relative" ref={dropdownRef}>
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-indigo-400" />
                      Contacto Destinatario
                    </Label>
                    
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none">
                        <Search className="h-4 w-4 text-slate-500" />
                      </div>
                      <Input
                        type="text"
                        placeholder="Buscar destinatario por nombre o escribir número directo..."
                        value={phoneSearchText}
                        onChange={(e) => {
                          setPhoneSearchText(e.target.value);
                          setShowDropdown(true);
                          setSelectedContact(null); // resetea contacto seleccionado si escribe algo nuevo
                          setCustomPhone(e.target.value);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        className="bg-slate-900/60 border-slate-800 text-white pl-10 pr-10 py-5 rounded-xl text-sm focus-visible:ring-indigo-500 focus-visible:border-indigo-500 font-medium"
                      />
                      
                      {selectedContact && (
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                          <Badge className="bg-emerald-950 border border-emerald-900/50 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center gap-1">
                            <Check className="w-3 h-3" /> Seleccionado
                          </Badge>
                        </div>
                      )}

                      {/* Dropdown de Opciones Autocompletado */}
                      {showDropdown && filteredContacts.length > 0 && (
                        <div className="absolute w-full mt-1.5 z-50 rounded-xl bg-slate-950 border border-slate-800 shadow-2xl max-h-60 overflow-y-auto backdrop-blur-md divide-y divide-slate-900">
                          {filteredContacts.map(c => (
                            <div
                              key={c.id}
                              onClick={() => {
                                setSelectedContact(c);
                                setPhoneSearchText(`${c.name} (+${c.phone_number})`);
                                setShowDropdown(false);
                              }}
                              className="px-4 py-3 hover:bg-indigo-600 hover:text-white text-xs font-semibold text-slate-200 cursor-pointer flex justify-between items-center transition-colors duration-150"
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                                <span>{c.name}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">+{c.phone_number}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Puedes buscar un contacto guardado o escribir un número directo con código de país (Ej: 549342555555).
                    </p>
                  </div>

                  {/* Drag & Drop File Zone */}
                  <div className="space-y-2.5">
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      Documento PDF a Adjuntar
                    </Label>
                    
                    <div 
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => !selectedFile && document.getElementById('file-input-id').click()}
                      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 relative group overflow-hidden ${
                        dragActive 
                          ? 'border-indigo-500 bg-slate-900/60' 
                          : selectedFile 
                            ? 'border-emerald-500/40 bg-slate-900/20' 
                            : 'border-slate-800 bg-slate-900/25 hover:border-indigo-500/40 hover:bg-slate-900/40'
                      }`}
                    >
                      <input 
                        type="file" 
                        id="file-input-id" 
                        accept="application/pdf" 
                        onChange={(e) => e.target.files[0] && validateAndSetFile(e.target.files[0])}
                        className="hidden" 
                      />

                      {!selectedFile ? (
                        <div className="space-y-4 py-4">
                          <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-all duration-300 shadow-inner">
                            <UploadCloud className="w-7 h-7" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-200">
                              Arrastra tu archivo PDF aquí o <span className="text-indigo-400 group-hover:text-indigo-300 transition-colors">explora tus archivos</span>
                            </p>
                            <p className="text-xs text-slate-500 mt-1.5">Límite de tamaño: 50 MB &bull; Únicamente formato PDF</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-900">
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-11 h-11 rounded-lg bg-red-950/80 border border-red-900/40 flex items-center justify-center text-red-400 flex-shrink-0 font-extrabold text-xs tracking-wider shadow">
                              PDF
                            </div>
                            <div className="text-left min-w-0">
                              <p className="text-xs font-bold text-slate-100 truncate pr-4">{selectedFile.name}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFile(null);
                            }}
                            className="h-8 w-8 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                          >
                            <X className="w-4.5 h-4.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Estado de Progreso del Envío */}
                  {uploading && (
                    <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-900 space-y-2.5 animate-pulse">
                      <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          {progressText}
                        </span>
                        <span className="font-mono text-indigo-400">{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2 bg-slate-900" />
                    </div>
                  )}

                  {/* Botón de Enviar */}
                  <Button 
                    type="submit" 
                    disabled={!selectedFile || uploading || !botStatus.connected}
                    className="w-full py-6 rounded-xl font-bold bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white shadow-lg disabled:opacity-50 transition-all duration-300 text-sm tracking-wider uppercase h-14"
                  >
                    {uploading ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4.5 h-4.5 animate-spin" /> Procesando Envío...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <MessageSquare className="w-4.5 h-4.5" /> Enviar por WhatsApp
                      </span>
                    )}
                  </Button>

                </form>
              </CardContent>
            </Card>
          </div>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full text-center py-5 border-t border-slate-900 relative z-10 text-[11px] text-slate-500 font-semibold tracking-wider uppercase bg-slate-950/40">
        WhatsApp PDF Automation &copy; {new Date().getFullYear()} &bull; Panel del Operador Autorizado &bull; Municipalidad de Santa Fe
      </footer>

      {/* MODAL DE GESTIÓN DE CONTACTOS */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-3xl bg-slate-950 border-slate-900 text-slate-100 rounded-3xl overflow-hidden shadow-2xl p-6">
          <DialogHeader className="pb-4 border-b border-slate-900">
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2.5">
              <Users className="w-5.5 h-5.5 text-indigo-400" />
              Gestión de Contactos Destinatarios
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Administra la base de datos de operadores y oficinas autorizadas para recibir documentos.
            </DialogDescription>
          </DialogHeader>

          {/* Formulario de Alta Rápida */}
          <form onSubmit={handleCreateContact} className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/30 p-4 rounded-xl border border-slate-900/50 mt-4">
            <div className="space-y-1">
              <Label htmlFor="c-name" className="text-[10px] uppercase font-bold text-slate-500">Nombre Oficina / Operador</Label>
              <Input 
                id="c-name"
                placeholder="Ej. Mesa de Entradas" 
                value={newContact.name}
                onChange={(e) => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                className="bg-slate-950 border-slate-800 text-xs h-9 rounded-lg"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="c-phone" className="text-[10px] uppercase font-bold text-slate-500">Teléfono (con Cód. País)</Label>
              <Input 
                id="c-phone"
                placeholder="Ej. 549342555555" 
                value={newContact.phone}
                onChange={(e) => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                className="bg-slate-950 border-slate-800 text-xs h-9 rounded-lg"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm" className="w-full bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs h-9 rounded-lg">
                <UserPlus className="w-4 h-4 mr-1.5" /> Agregar Contacto
              </Button>
            </div>
          </form>

          {/* Buscador de contactos */}
          <div className="flex items-center gap-3 justify-between mt-4">
            <div className="relative w-full sm:w-72">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="w-4 h-4 text-slate-500" />
              </span>
              <Input 
                type="text" 
                placeholder="Filtrar por nombre o teléfono..." 
                value={contactSearchQuery}
                onChange={(e) => setContactSearchQuery(e.target.value)}
                className="w-full bg-slate-900/40 border-slate-900 pl-9 h-9 text-xs rounded-lg"
              />
            </div>
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
              Total: <span className="text-slate-300 font-mono">{contacts.length}</span> | Activos: <span className="text-emerald-400 font-mono">{activeContactsCount}</span>
            </div>
          </div>

          {/* Tabla de Contactos */}
          <div className="overflow-y-auto max-h-[40vh] border border-slate-900 rounded-xl bg-slate-950/40 mt-3 pr-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-900 bg-slate-900/10 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                  <th className="p-3 pl-4">Destinatario</th>
                  <th className="p-3">Teléfono</th>
                  <th className="p-3 text-center">Activo</th>
                  <th className="p-3 text-right pr-4">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-slate-900/40">
                {contacts
                  .filter(c => 
                    c.name.toLowerCase().includes(contactSearchQuery.toLowerCase().trim()) ||
                    c.phone_number.includes(contactSearchQuery.trim())
                  )
                  .map(c => {
                    const isEditing = editingContactId === c.id;
                    return (
                      <tr key={c.id} className="hover:bg-slate-900/15 transition-colors">
                        <td className="p-3 pl-4 font-semibold text-slate-200">
                          {isEditing ? (
                            <Input 
                              value={editingValues.name}
                              onChange={(e) => setEditingValues(prev => ({ ...prev, name: e.target.value }))}
                              className="bg-slate-950 border-slate-800 h-7 text-xs py-0.5 rounded px-2 w-full text-white font-medium"
                            />
                          ) : (
                            <span>{c.name}</span>
                          )}
                        </td>
                        <td className="p-3 text-slate-400 font-mono">
                          {isEditing ? (
                            <Input 
                              value={editingValues.phone_number}
                              onChange={(e) => setEditingValues(prev => ({ ...prev, phone_number: e.target.value }))}
                              className="bg-slate-950 border-slate-800 h-7 text-xs py-0.5 rounded px-2 w-full text-white font-medium"
                            />
                          ) : (
                            <span>+{c.phone_number}</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <input 
                            type="checkbox" 
                            checked={c.is_active}
                            onChange={() => handleToggleContactActive(c.id, c.is_active)}
                            className="w-4 h-4 rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="p-3 text-right pr-4 space-x-1.5 whitespace-nowrap">
                          {isEditing ? (
                            <Button 
                              onClick={() => saveEditContact(c.id)}
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-slate-900 rounded"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <Button 
                              onClick={() => startEditContact(c)}
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 rounded"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button 
                            onClick={() => handleDeleteContact(c.id)}
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-slate-900 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* TOAST ALERTA FLOTANTE */}
      {toast.show && (
        <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl border flex items-center gap-3 animate-fade-in shadow-2xl ${
          toast.type === 'success' 
            ? 'bg-emerald-950 border-emerald-900 text-emerald-300' 
            : 'bg-red-950 border-red-900 text-red-300'
        }`}>
          {toast.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          )}
          <span className="text-xs font-semibold tracking-wide pr-2">{toast.message}</span>
          <button onClick={() => setToast(prev => ({ ...prev, show: false }))} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

    </div>
  );
}
