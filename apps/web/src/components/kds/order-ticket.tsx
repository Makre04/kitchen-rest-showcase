"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

type ItemStatus = "PENDIENTE" | "PREPARANDO" | "LISTO" | "ENTREGADO";

interface ItemModifier {
  id: string;
  name: string;
  priceDelta: number | string;
}

interface OrderItem {
  id: string;
  quantity: number;
  notes: string | null;
  status: ItemStatus;
  product: { name: string } | null;
  isOpenItem?: boolean;
  customName?: string | null;
  modifiers?: ItemModifier[];
}

interface OrderTicketProps {
  orderNumber: string;
  tableNumber: number;
  waiterName: string;
  createdAt: string;
  items: OrderItem[];
  onItemAction: (orderId: string, itemId: string, newStatus: ItemStatus) => Promise<boolean>;
  onDeliverAll?: (orderId: string) => Promise<boolean>;
  orderId: string;
}

const ITEM_STATUS_CONFIG: Record<ItemStatus, { label: string; color: string; bg: string }> = {
  PENDIENTE: { label: "Pendiente", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  PREPARANDO: { label: "Preparando", color: "text-orange-400", bg: "bg-orange-400/10" },
  LISTO: { label: "Listo", color: "text-emerald-400", bg: "bg-emerald-400/10" },
  ENTREGADO: { label: "Entregado", color: "text-white/30", bg: "bg-white/5" },
};

export function OrderTicket({
  tableNumber,
  waiterName,
  createdAt,
  items,
  onItemAction,
  onDeliverAll,
  orderId,
}: OrderTicketProps) {
  const [elapsed, setElapsed] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
      if (diff < 60) setElapsed(`${diff}s`);
      else if (diff < 3600) setElapsed(`${Math.floor(diff / 60)}m`);
      else setElapsed(`${Math.floor(diff / 3600)}h`);
      setIsUrgent(diff > 600);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  const allListo = items.every((i) => i.status === "LISTO" || i.status === "ENTREGADO");
  const hasUrgent = isUrgent && items.some((i) => i.status === "PENDIENTE");
  const hasListoItems = items.some((i) => i.status === "LISTO");

  const handleSingleAction = async (itemId: string, newStatus: ItemStatus) => {
    if (busyItems.has(itemId)) return;
    setBusyItems((prev) => new Set(prev).add(itemId));
    try {
      await onItemAction(orderId, itemId, newStatus);
    } finally {
      setBusyItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  // Parallel: all pending items promoted to LISTO simultaneously
  const handleMarkAllReady = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      const pending = items.filter((i) => i.status !== "LISTO" && i.status !== "ENTREGADO");
      await Promise.all(pending.map((item) => onItemAction(orderId, item.id, "LISTO")));
    } finally {
      setBulkBusy(false);
    }
  };

  // Batch: single request to deliver all LISTO items
  const handleDeliverAll = async () => {
    if (bulkBusy || !onDeliverAll) return;
    setBulkBusy(true);
    try {
      await onDeliverAll(orderId);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 space-y-3 transition-all",
        allListo
          ? "border-emerald-400/30 bg-emerald-400/5"
          : hasUrgent
          ? "border-red-400/50 bg-red-400/5 animate-pulse"
          : "border-white/10 bg-[#1A1A1A]"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black text-white">{tableNumber}</span>
          <div>
            <div className="text-xs text-white/40">Mesa {tableNumber}</div>
            <div className="text-xs text-white/30">{waiterName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-sm font-bold", hasUrgent ? "text-red-400" : "text-white/40")}>
            {elapsed}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const config = ITEM_STATUS_CONFIG[item.status];
          const nextStatus: ItemStatus | null =
            item.status === "PENDIENTE" ? "PREPARANDO"
            : item.status === "PREPARANDO" ? "LISTO"
            : null;
          const isBusy = busyItems.has(item.id) || bulkBusy;
          const itemName = item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "—");
          const mods = Array.isArray(item.modifiers) ? item.modifiers : [];

          return (
            <div key={item.id} className={cn("rounded-xl p-3 transition-all", config.bg)}>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-white/80 w-8 text-center">
                  {item.quantity}x
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">
                    {itemName}
                  </div>
                </div>

                {nextStatus ? (
                  <button
                    disabled={isBusy}
                    onClick={() => handleSingleAction(item.id, nextStatus)}
                    className={cn(
                      "flex-shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
                      item.status === "PENDIENTE"
                        ? "bg-orange-500 text-white hover:bg-orange-600"
                        : "bg-emerald-500 text-white hover:bg-emerald-600"
                    )}
                  >
                    {isBusy ? "..." : item.status === "PENDIENTE" ? "Preparar" : "Listo!"}
                  </button>
                ) : (
                  <span className={cn("text-xs font-semibold px-3 py-1 rounded-full", config.color, config.bg)}>
                    {config.label}
                  </span>
                )}
              </div>

              {/* Modifiers */}
              {mods.length > 0 && (
                <div className="mt-1.5 ml-10 space-y-0.5">
                  {mods.map((m) => (
                    <div key={m.id} className="text-xs text-[var(--gold)]/80">
                      {m.name}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {item.notes && (
                <div className="mt-1 ml-10 text-xs text-[var(--gold)]">
                  {item.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!allListo && items.length > 1 && (
        <button
          disabled={bulkBusy}
          onClick={handleMarkAllReady}
          className="w-full rounded-xl bg-emerald-500/20 text-emerald-400 py-3 text-sm font-bold hover:bg-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {bulkBusy ? "Procesando..." : "Marcar todo listo"}
        </button>
      )}
      {hasListoItems && onDeliverAll && (
        <button
          disabled={bulkBusy}
          onClick={handleDeliverAll}
          className="w-full rounded-xl bg-blue-500/20 text-blue-300 py-3 text-sm font-bold hover:bg-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {bulkBusy ? "Entregando..." : "Entregar todo"}
        </button>
      )}
    </div>
  );
}
