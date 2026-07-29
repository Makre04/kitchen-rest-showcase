"use client";

import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  destination: "COCINA" | "BARRA";
}

interface CategoryTabsProps {
  categories: Category[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={cn(
            "flex-shrink-0 rounded-xl px-4 md:px-5 py-3 text-sm font-medium transition-all touch-manipulation min-h-[44px]",
            selected === cat.id
              ? "bg-[var(--gold)] text-black shadow-lg shadow-[var(--gold)]/20"
              : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
          )}
        >
          <span>{cat.name}</span>
          <span className={cn(
            "ml-1.5 text-[10px] uppercase tracking-wider",
            selected === cat.id ? "text-black/50" : "text-white/30"
          )}>
            {cat.destination === "COCINA" ? "C" : "B"}
          </span>
        </button>
      ))}
    </div>
  );
}
