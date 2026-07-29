"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { OrderTicket } from "@/components/kds/order-ticket";
import { ConnectionBanner } from "@/components/ui/connection-banner";
import { authFetch } from "@/lib/auth-client";

type ItemStatus = "PENDIENTE" | "PREPARANDO" | "LISTO" | "ENTREGADO";

interface KDSOrder {
  id: string;
  createdAt: string;
  table: { number: number };
  waiter: { name: string };
  items: {
    id: string;
    quantity: number;
    notes: string | null;
    status: ItemStatus;
    product: { name: string } | null;
    isOpenItem?: boolean;
    customName?: string | null;
    modifiers?: Array<{ id: string; name: string; priceDelta: string | number }>;
  }[];
}

export default function KDSBarraPage() {
  const [orders, setOrders] = useState<KDSOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const fetchingRef = useRef(false);
  // Connection status for the polling loop — drives the "unstable connection" banner
  const [connOk, setConnOk] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchOrders = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await authFetch(`/api/kds/barra`);
      if (res.status === 403) {
        setError("No tiene permisos para acceder a KDS Barra");
        return;
      }
      if (!res.ok) {
        setConnOk(false);
        return;
      }
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
      setError(null);
      setConnOk(true);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error("Error fetching KDS orders:", err);
      setConnOk(false);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 3000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("es-CR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Optimistic update: apply state change locally, revert on failure
  const handleItemAction = async (
    orderId: string,
    itemId: string,
    newStatus: ItemStatus
  ): Promise<boolean> => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, items: o.items.map((i) => (i.id === itemId ? { ...i, status: newStatus } : i)) }
          : o
      )
    );
    try {
      const res = await authFetch(`/api/orders/${orderId}/items/${itemId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        await fetchOrders();
        return false;
      }
      return true;
    } catch (err) {
      console.error("Error updating item:", err);
      await fetchOrders();
      return false;
    }
  };

  // Batch: single request to deliver all LISTO items for an order
  const handleDeliverAll = async (orderId: string): Promise<boolean> => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, items: o.items.map((i) => (i.status === "LISTO" ? { ...i, status: "ENTREGADO" as ItemStatus } : i)) }
          : o
      )
    );
    try {
      const res = await authFetch(`/api/orders/${orderId}/items/deliver-all`, {
        method: "POST",
      });
      if (!res.ok) {
        await fetchOrders();
        return false;
      }
      return true;
    } catch (err) {
      console.error("Error en deliver-all:", err);
      await fetchOrders();
      return false;
    }
  };

  const pendingOrders = orders.filter((o) =>
    o.items.some((i) => i.status === "PENDIENTE" || i.status === "PREPARANDO")
  );
  const readyOrders = orders.filter((o) =>
    o.items.every((i) => i.status === "LISTO" || i.status === "ENTREGADO")
  );

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-4">
      <header className="flex items-center justify-between mb-4 md:mb-6 gap-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight whitespace-nowrap">
            <span className="text-blue-400">KDS</span>{" "}
            <span className="text-white/40 font-light">Barra</span>
          </h1>
          <div className="hidden md:block h-6 w-px bg-white/10" />
          {clock && (
            <span className="hidden md:inline text-white/30 text-sm font-mono">{clock}</span>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-white/5 rounded-full px-3 py-1.5 md:px-4 md:py-2">
            <span className="text-xs md:text-sm text-white/50">Pend.</span>
            <span className="text-base md:text-lg font-bold text-blue-400">
              {pendingOrders.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/5 rounded-full px-3 py-1.5 md:px-4 md:py-2">
            <span className="text-xs md:text-sm text-white/50">Listos</span>
            <span className="text-base md:text-lg font-bold text-emerald-400">
              {readyOrders.length}
            </span>
          </div>
          <a
            href="/"
            className="text-white/30 hover:text-white/60 text-sm transition-colors hidden sm:inline"
          >
            Mesas
          </a>
        </div>
      </header>

      {error ? (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <div className="text-xl text-red-400">{error}</div>
          <a href="/" className="mt-4 text-sm text-white/40 hover:text-white/60 underline">
            Volver a Mesas
          </a>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white/5 animate-pulse h-48" />
          ))}
        </div>
      ) : pendingOrders.length === 0 && readyOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <div className="text-xl text-white/20">Sin ordenes de barra</div>
          <div className="text-sm text-white/10 mt-2">
            Las bebidas y cocteles aparecen aqui automaticamente
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pendingOrders.map((order) => (
            <OrderTicket
              key={order.id}
              orderId={order.id}
              orderNumber={order.id.slice(-6)}
              tableNumber={order.table.number}
              waiterName={order.waiter.name}
              createdAt={order.createdAt}
              items={order.items}
              onItemAction={handleItemAction}
              onDeliverAll={handleDeliverAll}
            />
          ))}
          {readyOrders.map((order) => (
            <OrderTicket
              key={order.id}
              orderId={order.id}
              orderNumber={order.id.slice(-6)}
              tableNumber={order.table.number}
              waiterName={order.waiter.name}
              createdAt={order.createdAt}
              items={order.items}
              onItemAction={handleItemAction}
              onDeliverAll={handleDeliverAll}
            />
          ))}
        </div>
      )}

      <ConnectionBanner visible={!connOk} lastUpdated={lastUpdated} />
    </div>
  );
}
