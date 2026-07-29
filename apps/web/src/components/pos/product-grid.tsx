"use client";

import { cn } from "@/lib/utils";
import { formatCRC } from "@/lib/constants";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
}

interface ProductGridProps {
  products: Product[];
  onAdd: (product: Product) => void;
}

export function ProductGrid({ products, onAdd }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-white/20">
        Seleccione una categoría
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
      {products.map((product) => (
        <button
          key={product.id}
          onClick={() => onAdd(product)}
          className={cn(
            "flex flex-col items-start rounded-xl bg-white/5 border border-white/5 p-3 md:p-4",
            "hover:bg-white/10 hover:border-[var(--gold)]/30 hover:shadow-lg hover:shadow-black/20",
            "active:scale-[0.97] transition-all text-left touch-manipulation",
            "min-h-[90px] md:min-h-[100px]"
          )}
        >
          <span className="text-sm font-semibold text-white leading-tight">{product.name}</span>
          {product.description && (
            <span className="text-xs text-white/30 mt-1 line-clamp-2 leading-tight hidden sm:block">
              {product.description}
            </span>
          )}
          <span className="mt-auto pt-2 text-sm font-bold text-[var(--gold)]">
            {formatCRC(Number(product.price))}
          </span>
        </button>
      ))}
    </div>
  );
}

export { formatCRC };
