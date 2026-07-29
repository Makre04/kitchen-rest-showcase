"use client";

import { useEffect, useState, useCallback } from "react";
import { TableCard } from "@/components/tables/table-card";
import { StatusFilter } from "@/components/tables/status-filter";
import { TableDetailDialog } from "@/components/tables/table-detail-dialog";
import { ConnectionBanner } from "@/components/ui/connection-banner";
import { authFetch, getSession, logout } from "@/lib/auth-client";
import { useRoleGuard } from "@/lib/use-role-guard";

type TableStatus =
  | "LIBRE"
  | "OCUPADA"
  | "ESPERANDO_PEDIDO"
  | "EN_PREPARACION"
  | "PENDIENTE_PAGO"
  | "PAGO_PARCIAL";

// Summary shape returned by /api/tables/summary — lightweight for polling
interface TableSummary {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  orderCount: number;
  itemCount: number;
  hasPartialPayment: boolean;
  waiterName: string | null;
  covers: number | null;
  orders: { id: string; covers: number | null; waiter: { id: string; name: string } }[];
}

// Full shape expected by TableDetailDialog — loaded on demand
interface TableDetail {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  orders?: {
    id: string;
    covers?: number;
    waiter: { id: string; name: string };
    items: {
      id: string;
      quantity: number;
      status: string;
      unitPrice?: string;
      finalPrice?: string;
      isOpenItem?: boolean;
      customName?: string | null;
      notes?: string | null;
      product: { id: string; name: string; price?: string } | null;
      modifiers?: { id: string; name: string; priceDelta: number | string }[];
    }[];
    payments?: { id: string; paidAmount: string; status: string; createdAt: string }[];
  }[];
}

export default function Home() {
  const authState = useRoleGuard(["ADMINISTRADOR", "MESERO", "CAJERO", "COCINA", "BARRA"]);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [filter, setFilter] = useState<TableStatus | "TODAS">("TODAS");
  const [selectedTable, setSelectedTable] = useState<TableDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  // Connection status for the polling loop — drives the "unstable connection" banner
  const [connOk, setConnOk] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    const session = getSession();
    if (session?.user.role === "ADMINISTRADOR") setIsAdmin(true);
  }, []);

  // Poll lightweight summary every 3 s
  const fetchTables = useCallback(async () => {
    try {
      const res = await authFetch(`/api/tables/summary`);
      if (!res.ok) {
        setConnOk(false);
        return;
      }
      const data = await res.json();
      const arr: TableSummary[] = Array.isArray(data) ? data : [];
      setTables(arr);
      setConnOk(true);
      setLastUpdated(Date.now());
      // Keep selectedTable in sync if dialog is open
      setSelectedTable((prev) => {
        if (!prev) return null;
        const updated = arr.find((t) => t.id === prev.id);
        if (!updated) return null;
        // Only update shallow fields — don't overwrite full orders/items
        return { ...prev, status: updated.status, number: updated.number };
      });
    } catch (err) {
      console.error("Error fetching tables:", err);
      setConnOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
    const interval = setInterval(fetchTables, 3000);
    return () => clearInterval(interval);
  }, [fetchTables]);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load full detail only when the user clicks a table
  const handleSelectTable = useCallback(async (id: string) => {
    const summary = tables.find((t) => t.id === id);
    if (!summary) return;
    // Open dialog immediately with summary data (no orders yet) so it feels instant
    setSelectedTable({ id: summary.id, number: summary.number, capacity: summary.capacity, status: summary.status });
    setDialogOpen(true);
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/tables/${id}`);
      if (res.ok) {
        const full: TableDetail = await res.json();
        setSelectedTable(full);
      }
    } catch (err) {
      console.error("Error fetching table detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }, [tables]);

  const handleChangeStatus = async (id: string, status: TableStatus) => {
    try {
      await authFetch(`/api/tables/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setDialogOpen(false);
      await fetchTables();
    } catch (err) {
      console.error("Error updating table:", err);
    }
  };

  // Refresh detail after mutations — summary + full detail run in parallel
  const handleRefresh = useCallback(async () => {
    if (selectedTable) {
      const [, detailRes] = await Promise.all([
        fetchTables(),
        authFetch(`/api/tables/${selectedTable.id}`).catch(() => null),
      ]);
      if (detailRes?.ok) setSelectedTable(await detailRes.json());
    } else {
      await fetchTables();
    }
  }, [fetchTables, selectedTable]);

  const filteredTables =
    filter === "TODAS" ? tables : tables.filter((t) => t.status === filter);

  const counts = tables.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      acc.TODAS = (acc.TODAS || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  if (authState !== "authorized") {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-3 md:p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-4 md:mb-8 gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight whitespace-nowrap">
            <span className="text-[var(--gold)]">KITCHEN</span>{" "}
            <span className="text-white/40 font-light">Mesas</span>
          </h1>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          {clock && <span className="hidden md:inline text-white/30 text-sm">{clock}</span>}
        </div>

        <nav className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <a href="/kds/cocina" className="text-xs md:text-sm text-white/30 hover:text-orange-400 transition-colors hidden sm:inline">KDS Cocina</a>
          <a href="/kds/barra" className="text-xs md:text-sm text-white/30 hover:text-blue-400 transition-colors hidden sm:inline">KDS Barra</a>
          <a href="/caja" className="text-xs md:text-sm text-white/30 hover:text-emerald-400 transition-colors">Caja</a>
          <a href="/facturacion" className="text-xs md:text-sm text-white/30 hover:text-purple-400 transition-colors hidden sm:inline">Facturación</a>
          {isAdmin && <a href="/admin" className="text-xs md:text-sm text-[var(--gold)]/50 hover:text-[var(--gold)] transition-colors font-medium">Admin</a>}
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 hidden sm:inline">En línea</span>
          </div>
          <button onClick={logout} className="p-1 text-white/20 hover:text-red-400 transition-colors touch-manipulation" title="Cerrar sesión">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </nav>
      </header>

      {/* Filters */}
      <div className="mb-4 md:mb-8">
        <StatusFilter
          selected={filter}
          counts={counts as Record<TableStatus | "TODAS", number>}
          onChange={setFilter}
        />
      </div>

      {/* Tables Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-2xl bg-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredTables.map((table) => (
            <TableCard
              key={table.id}
              id={table.id}
              number={table.number}
              capacity={table.capacity}
              status={table.status}
              waiterName={table.waiterName ?? undefined}
              itemCount={table.itemCount}
              covers={table.covers ?? undefined}
              onSelect={handleSelectTable}
            />
          ))}
        </div>
      )}

      {filteredTables.length === 0 && !loading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-white/20 text-lg">
            No hay mesas con este estado
          </div>
        </div>
      )}

      <ConnectionBanner visible={!connOk} lastUpdated={lastUpdated} />

      {/* Detail Dialog */}
      <TableDetailDialog
        table={selectedTable}
        tables={tables as unknown as TableDetail[]}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onChangeStatus={handleChangeStatus}
        onRefresh={handleRefresh}
        detailLoading={detailLoading}
      />
    </div>
  );
}
