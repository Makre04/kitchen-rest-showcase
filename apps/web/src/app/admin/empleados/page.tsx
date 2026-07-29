"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";

interface Employee {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
  role: string;
  branch: string;
  branchId: string;
  pinPlain: string | null;
  ordersCount: number;
  cashSessionsCount: number;
  createdAt: string;
}

interface Branch { id: string; name: string }

const ROLES = ["ADMINISTRADOR", "CAJERO", "MESERO", "COCINA", "BARRA"] as const;
const ROLE_COLORS: Record<string, string> = {
  ADMINISTRADOR: "text-red-400 bg-red-400/10",
  CAJERO: "text-emerald-400 bg-emerald-400/10",
  MESERO: "text-blue-400 bg-blue-400/10",
  COCINA: "text-orange-400 bg-orange-400/10",
  BARRA: "text-purple-400 bg-purple-400/10",
};

type View = "list" | "create" | "edit";

function generateRandomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function EmpleadosPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("TODOS");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formPin, setFormPin] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState<string>("MESERO");
  const [formBranch, setFormBranch] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [generatedPinFor, setGeneratedPinFor] = useState<{ id: string; name: string; pin: string } | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [empRes, brRes] = await Promise.all([
        authFetch("/api/admin/empleados"),
        authFetch("/api/admin/sucursales"),
      ]);
      const empData = await empRes.json();
      const brData = await brRes.json();
      setEmployees(Array.isArray(empData) ? empData : []);
      setBranches(Array.isArray(brData) ? brData : []);
      if (brData.length > 0 && !formBranch) setFormBranch(brData[0].id);
    } catch { /* ignore */ }
    setLoading(false);
  }, [formBranch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetForm = () => {
    setFormName(""); setFormPin(""); setFormEmail(""); setFormRole("MESERO");
    setFormActive(true); setEditId(null); setShowPin(false);
    if (branches.length > 0) setFormBranch(branches[0].id);
  };

  const handleGeneratePin = () => {
    const pin = generateRandomPin();
    setFormPin(pin);
    setShowPin(true);
  };

  const handleRegeneratePin = async (emp: Employee) => {
    const pin = generateRandomPin();
    setRegenerating(emp.id);
    try {
      const res = await authFetch(`/api/admin/empleados/${emp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        setMsg({ type: "err", text: "Error al regenerar PIN" });
        return;
      }
      setGeneratedPinFor({ id: emp.id, name: emp.name, pin });
    } catch {
      setMsg({ type: "err", text: "Error de conexión" });
    } finally {
      setRegenerating(null);
    }
  };

  const openCreate = () => { resetForm(); setView("create"); setMsg(null); };
  const openEdit = (emp: Employee) => {
    setEditId(emp.id);
    setFormName(emp.name);
    setFormPin("");
    setFormEmail(emp.email || "");
    setFormRole(emp.role);
    setFormBranch(emp.branchId);
    setFormActive(emp.active);
    setView("edit");
    setMsg(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setMsg({ type: "err", text: "Nombre requerido" }); return; }
    if (view === "create" && formPin.length < 4) { setMsg({ type: "err", text: "PIN mínimo 4 dígitos" }); return; }
    setSaving(true); setMsg(null);
    try {
      if (view === "create") {
        const res = await authFetch("/api/admin/empleados", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            pin: formPin,
            email: formEmail.trim() || undefined,
            roleName: formRole,
            branchId: formBranch,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMsg({ type: "err", text: typeof data.error === "string" ? data.error : JSON.stringify(data.error) });
          return;
        }
        setMsg({ type: "ok", text: `${data.name} creado correctamente` });
      } else {
        const body: Record<string, unknown> = { name: formName.trim(), roleName: formRole, active: formActive };
        if (formPin.length >= 4) body.pin = formPin;
        if (formEmail.trim()) body.email = formEmail.trim();
        else body.email = null;

        const res = await authFetch(`/api/admin/empleados/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setMsg({ type: "err", text: typeof data.error === "string" ? data.error : JSON.stringify(data.error) });
          return;
        }
        setMsg({ type: "ok", text: `${data.name} actualizado` });
      }
      await fetchData();
      setTimeout(() => { setView("list"); setMsg(null); }, 1200);
    } catch {
      setMsg({ type: "err", text: "Error de conexión" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (emp: Employee) => {
    await authFetch(`/api/admin/empleados/${emp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !emp.active }),
    });
    fetchData();
  };

  const filtered = employees.filter((e) => {
    if (filterRole !== "TODOS" && e.role !== filterRole) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-full text-white/30">Cargando...</div>;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Gestión de Empleados</h2>
          <p className="text-white/30 text-sm mt-1">{employees.length} empleados registrados</p>
        </div>
        {view === "list" && (
          <button onClick={openCreate} className="px-5 py-2.5 rounded-xl bg-[var(--gold)] text-black font-semibold text-sm hover:bg-[var(--gold)]/80 transition-colors">
            + Nuevo Empleado
          </button>
        )}
      </div>

      {msg && (
        <div className={`rounded-xl p-3 text-sm ${msg.type === "ok" ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20" : "bg-red-400/10 text-red-400 border border-red-400/20"}`}>
          {msg.text}
        </div>
      )}

      {generatedPinFor && (
        <div className="rounded-xl bg-[var(--gold)]/5 border border-[var(--gold)]/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-white/40">Nuevo PIN para </span>
              <span className="text-sm font-bold text-white">{generatedPinFor.name}</span>
            </div>
            <span className="text-2xl font-mono font-bold text-[var(--gold)] tracking-[0.3em] bg-black/30 rounded-lg px-4 py-1">
              {generatedPinFor.pin}
            </span>
          </div>
          <button onClick={() => setGeneratedPinFor(null)} className="text-white/30 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* CREATE / EDIT FORM */}
      {(view === "create" || view === "edit") && (
        <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{view === "create" ? "Nuevo Empleado" : "Editar Empleado"}</h3>
            <button onClick={() => { setView("list"); setMsg(null); }} className="text-white/30 hover:text-white text-sm">Cancelar</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/40 block mb-1">Nombre completo *</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" placeholder="Juan Pérez" />
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">PIN {view === "create" ? "*" : "(dejar vacío para no cambiar)"}</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type={showPin ? "text" : "password"} value={formPin} onChange={(e) => setFormPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 pr-10" placeholder="****" maxLength={6} />
                  {formPin && (
                    <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        {showPin ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>}
                      </svg>
                    </button>
                  )}
                </div>
                <button type="button" onClick={handleGeneratePin} className="px-4 py-3 rounded-xl bg-[var(--gold)]/10 text-[var(--gold)] text-xs font-bold hover:bg-[var(--gold)]/20 transition-colors whitespace-nowrap border border-[var(--gold)]/20">
                  Generar código
                </button>
              </div>
              {showPin && formPin && (
                <div className="mt-2 rounded-lg bg-emerald-400/5 border border-emerald-400/20 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-white/40">Código generado:</span>
                  <span className="text-lg font-mono font-bold text-emerald-400 tracking-[0.3em]">{formPin}</span>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Email (opcional)</label>
              <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Rol *</label>
              <select value={formRole} onChange={(e) => setFormRole(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 appearance-none">
                {ROLES.map((r) => <option key={r} value={r} className="bg-[#1A1A1A]">{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Sucursal *</label>
              <select value={formBranch} onChange={(e) => setFormBranch(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 appearance-none">
                {branches.map((b) => <option key={b.id} value={b.id} className="bg-[#1A1A1A]">{b.name}</option>)}
              </select>
            </div>
            {view === "edit" && (
              <div className="flex items-center gap-3 pt-6">
                <button type="button" onClick={() => setFormActive(!formActive)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formActive ? "bg-emerald-400" : "bg-white/20"}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formActive ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <span className="text-sm text-white/60">{formActive ? "Activo" : "Inactivo"}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setView("list"); setMsg(null); }} className="px-5 py-2.5 rounded-xl bg-white/5 text-white/60 text-sm hover:bg-white/10 transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl bg-[var(--gold)] text-black font-semibold text-sm hover:bg-[var(--gold)]/80 disabled:opacity-40 transition-colors">
              {saving ? "Guardando..." : view === "create" ? "Crear Empleado" : "Guardar Cambios"}
            </button>
          </div>
        </div>
      )}

      {/* LIST */}
      {view === "list" && (
        <>
          <div className="flex gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre..." className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" />
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none appearance-none">
              <option value="TODOS" className="bg-[#1A1A1A]">Todos los roles</option>
              {ROLES.map((r) => <option key={r} value={r} className="bg-[#1A1A1A]">{r}</option>)}
            </select>
          </div>

          <div className="rounded-2xl bg-[#1A1A1A] border border-white/5 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Nombre</th>
                  <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Rol</th>
                  <th className="text-center text-xs text-white/30 font-medium px-5 py-3">Código</th>
                  <th className="text-left text-xs text-white/30 font-medium px-5 py-3">Email</th>
                  <th className="text-center text-xs text-white/30 font-medium px-5 py-3">Órdenes</th>
                  <th className="text-center text-xs text-white/30 font-medium px-5 py-3">Estado</th>
                  <th className="text-right text-xs text-white/30 font-medium px-5 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-4">
                      <p className={`text-sm font-medium ${emp.active ? "text-white" : "text-white/30"}`}>{emp.name}</p>
                      <p className="text-[10px] text-white/20 mt-0.5">{emp.branch}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[emp.role] || "text-white/40 bg-white/5"}`}>
                        {emp.role}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="font-mono font-bold text-[var(--gold)] tracking-[0.2em] text-sm">
                        {generatedPinFor?.id === emp.id ? generatedPinFor.pin : emp.pinPlain || "••••"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-white/40">{emp.email || "—"}</td>
                    <td className="px-5 py-4 text-sm text-white/40 text-center">{emp.ordersCount}</td>
                    <td className="px-5 py-4 text-center">
                      <button onClick={() => toggleActive(emp)} className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${emp.active ? "bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20" : "bg-red-400/10 text-red-400 hover:bg-red-400/20"}`}>
                        {emp.active ? "Activo" : "Inactivo"}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button onClick={() => openEdit(emp)} className="text-xs text-[var(--gold)]/60 hover:text-[var(--gold)] transition-colors">
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-white/20 text-sm">No se encontraron empleados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
