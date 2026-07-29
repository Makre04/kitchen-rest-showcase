"use client";

import { cn } from "@/lib/utils";

type TableStatus =
  | "LIBRE"
  | "OCUPADA"
  | "ESPERANDO_PEDIDO"
  | "EN_PREPARACION"
  | "PENDIENTE_PAGO"
  | "PAGO_PARCIAL";

interface TableCardProps {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  waiterName?: string;
  itemCount?: number;
  covers?: number;
  onSelect: (id: string) => void;
}

const STATUS_CONFIG: Record<
  TableStatus,
  { label: string; color: string; bg: string; border: string; pulse?: boolean }
> = {
  LIBRE: {
    label: "Libre",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
  },
  OCUPADA: {
    label: "Ocupada",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
  },
  ESPERANDO_PEDIDO: {
    label: "Esperando pedido",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
    pulse: true,
  },
  EN_PREPARACION: {
    label: "En preparación",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/30",
  },
  PENDIENTE_PAGO: {
    label: "Pendiente de pago",
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    pulse: true,
  },
  PAGO_PARCIAL: {
    label: "Pago parcial",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/30",
    pulse: true,
  },
};

export function TableCard({
  id,
  number,
  capacity,
  status,
  waiterName,
  itemCount,
  covers,
  onSelect,
}: TableCardProps) {
  const config = STATUS_CONFIG[status];

  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-2xl border-2 p-3 md:p-6 transition-all duration-200",
        "hover:scale-[1.03] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98]",
        "min-h-[120px] md:min-h-[160px] w-full touch-manipulation cursor-pointer",
        config.bg,
        config.border
      )}
    >
      {config.pulse && (
        <span
          className={cn(
            "absolute top-3 right-3 h-3 w-3 rounded-full animate-pulse",
            status === "ESPERANDO_PEDIDO" ? "bg-blue-400" : "bg-red-400"
          )}
        />
      )}

      <span className="text-3xl md:text-5xl font-bold text-white">{number}</span>

      <span
        className={cn(
          "mt-2 md:mt-3 rounded-full px-2 md:px-3 py-0.5 md:py-1 text-[10px] md:text-xs font-semibold uppercase tracking-wider text-center leading-tight",
          config.color,
          config.bg
        )}
      >
        {config.label}
      </span>

      <div className="mt-2 md:mt-3 flex items-center gap-1.5 md:gap-3 text-xs text-white/40 flex-wrap justify-center">
        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {covers && covers > 0 ? <span className="text-white/70">{covers}/{capacity}</span> : capacity}
        </span>
        {waiterName && (
          <span className="text-white/50 truncate max-w-[100px]">
            {waiterName}
          </span>
        )}
        {itemCount !== undefined && itemCount > 0 && (
          <span className="text-[var(--gold)]">{itemCount} items</span>
        )}
      </div>
    </button>
  );
}
