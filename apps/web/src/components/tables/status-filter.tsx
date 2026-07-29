"use client";

import { cn } from "@/lib/utils";

type TableStatus =
  | "LIBRE"
  | "OCUPADA"
  | "ESPERANDO_PEDIDO"
  | "EN_PREPARACION"
  | "PENDIENTE_PAGO"
  | "PAGO_PARCIAL";

interface StatusFilterProps {
  selected: TableStatus | "TODAS";
  counts: Record<TableStatus | "TODAS", number>;
  onChange: (status: TableStatus | "TODAS") => void;
}

const FILTERS: { value: TableStatus | "TODAS"; label: string; color: string }[] = [
  { value: "TODAS", label: "Todas", color: "text-white" },
  { value: "LIBRE", label: "Libres", color: "text-emerald-400" },
  { value: "OCUPADA", label: "Ocupadas", color: "text-amber-400" },
  { value: "ESPERANDO_PEDIDO", label: "Esperando", color: "text-blue-400" },
  { value: "EN_PREPARACION", label: "Preparando", color: "text-orange-400" },
  { value: "PENDIENTE_PAGO", label: "Por cobrar", color: "text-red-400" },
  { value: "PAGO_PARCIAL", label: "Pago parcial", color: "text-purple-400" },
];

export function StatusFilter({ selected, counts, onChange }: StatusFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          onClick={() => onChange(filter.value)}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all",
            selected === filter.value
              ? "bg-white/10 shadow-inner"
              : "bg-white/5 hover:bg-white/8"
          )}
        >
          <span className={filter.color}>{filter.label}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50">
            {counts[filter.value] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
