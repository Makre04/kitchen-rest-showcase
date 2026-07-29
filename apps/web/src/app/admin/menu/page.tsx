"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/auth-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCRC } from "@/lib/constants";

// ── Types ──────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  destination: "COCINA" | "BARRA";
  active: boolean;
  _count: { products: number };
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  categoryId: string;
  productType: string;
  active: boolean;
  imageUrl: string | null;
  allowModifiers: boolean;
  allowNotes: boolean;
  requiresCustomization: boolean;
  category: { id: string; name: string; destination: string };
  _count: { modifierGroups: number };
}

interface ModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  active: boolean;
  sortOrder: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  sortOrder: number;
  options: ModifierOption[];
}

type Tab = "products" | "categories" | "modifiers" | "inactive";

const PRODUCT_TYPES = [
  { value: "FOOD", label: "Comida" },
  { value: "COCKTAIL", label: "Coctel" },
  { value: "LIQUOR", label: "Licor" },
  { value: "BEER", label: "Cerveza" },
  { value: "SIMPLE_DRINK", label: "Bebida simple" },
  { value: "OPEN_PRESET", label: "Preset abierto" },
];

const TYPE_COLORS: Record<string, string> = {
  FOOD: "text-orange-400 bg-orange-400/10",
  COCKTAIL: "text-purple-400 bg-purple-400/10",
  LIQUOR: "text-amber-400 bg-amber-400/10",
  BEER: "text-yellow-400 bg-yellow-400/10",
  SIMPLE_DRINK: "text-cyan-400 bg-cyan-400/10",
  OPEN_PRESET: "text-pink-400 bg-pink-400/10",
};

// ── Main Page ──────────────────────────────────────────────

export default function AdminMenuPage() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("TODAS");
  const [filterDest, setFilterDest] = useState("TODOS");
  const [filterType, setFilterType] = useState("TODOS");

  // Dialogs
  const [productDialog, setProductDialog] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [modifierDialog, setModifierDialog] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        authFetch("/api/admin/products"),
        authFetch("/api/admin/categories"),
      ]);
      if (pRes.ok) {
        const data = await pRes.json();
        setProducts(data.map((p: any) => ({ ...p, price: Number(p.price) })));
      }
      if (cRes.ok) setCategories(await cRes.json());
    } catch {
      flash("err", "Error cargando datos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = products.filter((p) => {
    if (tab === "inactive") return !p.active;
    if (!p.active) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== "TODAS" && p.categoryId !== filterCat) return false;
    if (filterDest !== "TODOS" && p.category.destination !== filterDest) return false;
    if (filterType !== "TODOS" && p.productType !== filterType) return false;
    return true;
  });

  const toggleProduct = async (id: string) => {
    const res = await authFetch(`/api/admin/products/${id}/toggle`, { method: "PATCH" });
    if (res.ok) {
      fetchAll();
      flash("ok", "Producto actualizado");
    }
  };

  const openEditProduct = (p: Product) => {
    setEditProduct(p);
    setProductDialog(true);
  };

  const openNewProduct = () => {
    setEditProduct(null);
    setProductDialog(true);
  };

  const openModifiers = async (p: Product) => {
    setModifierProduct(p);
    const res = await authFetch(`/api/admin/products/${p.id}/modifiers`);
    if (res.ok) {
      const data = await res.json();
      setModifierGroups(
        data.map((g: any) => ({
          ...g,
          options: g.options.map((o: any) => ({ ...o, priceDelta: Number(o.priceDelta) })),
        }))
      );
    }
    setModifierDialog(true);
  };

  const openEditCategory = (c: Category) => {
    setEditCategory(c);
    setCategoryDialog(true);
  };

  const openNewCategory = () => {
    setEditCategory(null);
    setCategoryDialog(true);
  };

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: "products", label: "Productos", count: products.filter((p) => p.active).length },
    { key: "categories", label: "Categorias" },
    { key: "modifiers", label: "Modificadores" },
    { key: "inactive", label: "Inactivos", count: products.filter((p) => !p.active).length },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Menu</h1>
          <p className="text-sm text-white/40">Gestionar productos, categorias y modificadores</p>
        </div>
        <div className="flex gap-2">
          {tab === "categories" && (
            <Button onClick={openNewCategory} className="bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 font-semibold">
              + Nueva categoria
            </Button>
          )}
          {(tab === "products" || tab === "inactive") && (
            <Button onClick={openNewProduct} className="bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 font-semibold">
              + Nuevo producto
            </Button>
          )}
        </div>
      </div>

      {/* Flash */}
      {msg && (
        <div className={cn("mb-4 px-4 py-2 rounded-xl text-sm font-medium", msg.type === "ok" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400")}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === t.key ? "bg-[var(--gold)]/20 text-[var(--gold)]" : "text-white/40 hover:text-white/70"
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-xs opacity-60">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-white/30 text-center py-20">Cargando...</div>
      ) : (
        <>
          {/* Products tab */}
          {(tab === "products" || tab === "inactive") && (
            <ProductsTab
              products={filtered}
              categories={categories}
              search={search}
              onSearch={setSearch}
              filterCat={filterCat}
              onFilterCat={setFilterCat}
              filterDest={filterDest}
              onFilterDest={setFilterDest}
              filterType={filterType}
              onFilterType={setFilterType}
              onEdit={openEditProduct}
              onToggle={toggleProduct}
              onModifiers={openModifiers}
              isInactive={tab === "inactive"}
            />
          )}

          {/* Categories tab */}
          {tab === "categories" && (
            <CategoriesTab categories={categories} onEdit={openEditCategory} />
          )}

          {/* Modifiers tab */}
          {tab === "modifiers" && (
            <ModifiersOverview products={products.filter((p) => p.active && p._count.modifierGroups > 0)} onEdit={openModifiers} />
          )}
        </>
      )}

      {/* Product Form Dialog */}
      <ProductFormDialog
        open={productDialog}
        onClose={() => setProductDialog(false)}
        product={editProduct}
        categories={categories.filter((c) => c.active)}
        onSaved={() => { setProductDialog(false); fetchAll(); flash("ok", editProduct ? "Producto actualizado" : "Producto creado"); }}
        onError={(e) => flash("err", e)}
      />

      {/* Category Form Dialog */}
      <CategoryFormDialog
        open={categoryDialog}
        onClose={() => setCategoryDialog(false)}
        category={editCategory}
        onSaved={() => { setCategoryDialog(false); fetchAll(); flash("ok", editCategory ? "Categoria actualizada" : "Categoria creada"); }}
        onError={(e) => flash("err", e)}
      />

      {/* Modifier Editor Dialog */}
      <ModifierEditorDialog
        open={modifierDialog}
        onClose={() => setModifierDialog(false)}
        product={modifierProduct}
        groups={modifierGroups}
        onRefresh={async () => {
          if (!modifierProduct) return;
          const res = await authFetch(`/api/admin/products/${modifierProduct.id}/modifiers`);
          if (res.ok) {
            const data = await res.json();
            setModifierGroups(data.map((g: any) => ({ ...g, options: g.options.map((o: any) => ({ ...o, priceDelta: Number(o.priceDelta) })) })));
          }
        }}
        onFlash={flash}
      />
    </div>
  );
}

// ── Products Tab ───────────────────────────────────────────

function ProductsTab({
  products, categories, search, onSearch, filterCat, onFilterCat,
  filterDest, onFilterDest, filterType, onFilterType,
  onEdit, onToggle, onModifiers, isInactive,
}: {
  products: Product[];
  categories: Category[];
  search: string;
  onSearch: (v: string) => void;
  filterCat: string;
  onFilterCat: (v: string) => void;
  filterDest: string;
  onFilterDest: (v: string) => void;
  filterType: string;
  onFilterType: (v: string) => void;
  onEdit: (p: Product) => void;
  onToggle: (id: string) => void;
  onModifiers: (p: Product) => void;
  isInactive: boolean;
}) {
  return (
    <div>
      {/* Filters */}
      {!isInactive && (
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50 w-64"
          />
          <select value={filterCat} onChange={(e) => onFilterCat(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
            <option value="TODAS">Todas las categorias</option>
            {categories.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={filterDest} onChange={(e) => onFilterDest(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
            <option value="TODOS">Todos los destinos</option>
            <option value="COCINA">Cocina</option>
            <option value="BARRA">Barra</option>
          </select>
          <select value={filterType} onChange={(e) => onFilterType(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none">
            <option value="TODOS">Todos los tipos</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Table */}
      <div className="bg-[#111] rounded-2xl border border-white/5 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-white/5 text-white/40 text-left">
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Destino</th>
              <th className="px-4 py-3 font-medium text-right">Precio</th>
              <th className="px-4 py-3 font-medium text-center">Config</th>
              <th className="px-4 py-3 font-medium text-center">Modif.</th>
              <th className="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-white/20">
                  {isInactive ? "No hay productos inactivos" : "No se encontraron productos"}
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{p.name}</div>
                    {p.description && (
                      <div className="text-white/30 text-xs mt-0.5 truncate max-w-[200px]">{p.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/50">{p.category.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs px-2 py-1 rounded-lg", TYPE_COLORS[p.productType] || "text-white/40 bg-white/5")}>
                      {PRODUCT_TYPES.find((t) => t.value === p.productType)?.label || p.productType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs px-2 py-1 rounded-lg", p.category.destination === "COCINA" ? "text-orange-400 bg-orange-400/10" : "text-purple-400 bg-purple-400/10")}>
                      {p.category.destination}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--gold)] font-medium">{formatCRC(p.price)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {p.allowModifiers && <span className="w-2 h-2 rounded-full bg-emerald-400" title="Permite modificadores" />}
                      {p.allowNotes && <span className="w-2 h-2 rounded-full bg-blue-400" title="Permite notas" />}
                      {p.requiresCustomization && <span className="w-2 h-2 rounded-full bg-red-400" title="Requiere personalizacion" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p._count.modifierGroups > 0 ? (
                      <button
                        onClick={() => onModifiers(p)}
                        className="text-xs text-[var(--gold)] hover:underline"
                      >
                        {p._count.modifierGroups} grupo{p._count.modifierGroups > 1 ? "s" : ""}
                      </button>
                    ) : p.allowModifiers ? (
                      <button
                        onClick={() => onModifiers(p)}
                        className="text-xs text-white/20 hover:text-white/50"
                      >
                        + Agregar
                      </button>
                    ) : (
                      <span className="text-xs text-white/10">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => onEdit(p)} className="px-2.5 py-1.5 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                        Editar
                      </button>
                      <button
                        onClick={() => onToggle(p.id)}
                        className={cn("px-2.5 py-1.5 rounded-lg text-xs transition-colors", p.active ? "text-red-400/60 hover:text-red-400 hover:bg-red-400/10" : "text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-400/10")}
                      >
                        {p.active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-white/30">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Modificadores</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Notas</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Requiere personalizacion</span>
      </div>
    </div>
  );
}

// ── Categories Tab ─────────────────────────────────────────

function CategoriesTab({ categories, onEdit }: { categories: Category[]; onEdit: (c: Category) => void }) {
  return (
    <div className="bg-[#111] rounded-2xl border border-white/5 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-white/40 text-left">
            <th className="px-4 py-3 font-medium">Nombre</th>
            <th className="px-4 py-3 font-medium">Destino</th>
            <th className="px-4 py-3 font-medium text-center">Productos</th>
            <th className="px-4 py-3 font-medium text-center">Estado</th>
            <th className="px-4 py-3 font-medium text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="px-4 py-3 text-white font-medium">{c.name}</td>
              <td className="px-4 py-3">
                <span className={cn("text-xs px-2 py-1 rounded-lg", c.destination === "COCINA" ? "text-orange-400 bg-orange-400/10" : "text-purple-400 bg-purple-400/10")}>
                  {c.destination}
                </span>
              </td>
              <td className="px-4 py-3 text-center text-white/50">{c._count.products}</td>
              <td className="px-4 py-3 text-center">
                <span className={cn("text-xs px-2 py-1 rounded-lg", c.active ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10")}>
                  {c.active ? "Activa" : "Inactiva"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(c)} className="px-2.5 py-1.5 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Modifiers Overview Tab ─────────────────────────────────

function ModifiersOverview({ products, onEdit }: { products: Product[]; onEdit: (p: Product) => void }) {
  return (
    <div className="space-y-3">
      {products.length === 0 ? (
        <div className="text-center py-12 text-white/20 bg-[#111] rounded-2xl border border-white/5">
          No hay productos con modificadores
        </div>
      ) : (
        products.map((p) => (
          <div key={p.id} className="bg-[#111] rounded-2xl border border-white/5 p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
            <div>
              <span className="text-white font-medium">{p.name}</span>
              <span className="text-white/30 text-xs ml-2">{p.category.name}</span>
              <span className="text-[var(--gold)] text-xs ml-2">{p._count.modifierGroups} grupo{p._count.modifierGroups > 1 ? "s" : ""}</span>
            </div>
            <button onClick={() => onEdit(p)} className="px-3 py-1.5 rounded-lg text-xs text-[var(--gold)] hover:bg-[var(--gold)]/10 transition-colors">
              Editar modificadores
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ── Product Form Dialog ────────────────────────────────────

function ProductFormDialog({
  open, onClose, product, categories, onSaved, onError,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  categories: Category[];
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productType, setProductType] = useState("FOOD");
  const [allowModifiers, setAllowModifiers] = useState(true);
  const [allowNotes, setAllowNotes] = useState(true);
  const [requiresCustomization, setRequiresCustomization] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && product) {
      setName(product.name);
      setDescription(product.description || "");
      setPrice(String(product.price));
      setCategoryId(product.categoryId);
      setProductType(product.productType);
      setAllowModifiers(product.allowModifiers);
      setAllowNotes(product.allowNotes);
      setRequiresCustomization(product.requiresCustomization);
    } else if (open) {
      setName("");
      setDescription("");
      setPrice("");
      setCategoryId(categories[0]?.id || "");
      setProductType("FOOD");
      setAllowModifiers(true);
      setAllowNotes(true);
      setRequiresCustomization(false);
    }
  }, [open, product, categories]);

  const handleSave = async () => {
    if (!name.trim() || !price || !categoryId) {
      onError("Nombre, precio y categoria son requeridos");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        price: Number(price),
        categoryId,
        productType,
        allowModifiers,
        allowNotes,
        requiresCustomization,
      };

      const res = product
        ? await authFetch(`/api/admin/products/${product.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await authFetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

      if (res.ok) {
        onSaved();
      } else {
        const err = await res.json();
        onError(err.error?.fieldErrors ? "Datos invalidos" : (err.error || "Error guardando"));
      }
    } catch {
      onError("Error de conexion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#1A1A1A] border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{product ? "Editar producto" : "Nuevo producto"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs text-white/40 block mb-1">Nombre *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" />
          </div>

          <div>
            <label className="text-xs text-white/40 block mb-1">Descripcion</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/40 block mb-1">Precio *</label>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" />
            </div>
            <div>
              <label className="text-xs text-white/40 block mb-1">Tipo</label>
              <select value={productType} onChange={(e) => setProductType(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none">
                {PRODUCT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-white/40 block mb-1">Categoria *</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none">
              <option value="">Seleccionar...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.destination})</option>
              ))}
            </select>
          </div>

          <div className="border-t border-white/5 pt-4">
            <label className="text-xs text-white/40 block mb-3">Configuracion POS</label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={allowModifiers} onChange={(e) => setAllowModifiers(e.target.checked)} className="w-4 h-4 rounded accent-[var(--gold)]" />
                <span className="text-sm text-white/70">Permite modificadores</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={allowNotes} onChange={(e) => setAllowNotes(e.target.checked)} className="w-4 h-4 rounded accent-[var(--gold)]" />
                <span className="text-sm text-white/70">Permite notas</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={requiresCustomization} onChange={(e) => setRequiresCustomization(e.target.checked)} className="w-4 h-4 rounded accent-[var(--gold)]" />
                <span className="text-sm text-white/70">Requiere personalizacion antes de agregar</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="border-white/10 text-white/50 hover:text-white">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 font-semibold disabled:opacity-40">
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Category Form Dialog ───────────────────────────────────

function CategoryFormDialog({
  open, onClose, category, onSaved, onError,
}: {
  open: boolean;
  onClose: () => void;
  category: Category | null;
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<"COCINA" | "BARRA">("COCINA");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && category) {
      setName(category.name);
      setDestination(category.destination);
      setActive(category.active);
    } else if (open) {
      setName("");
      setDestination("COCINA");
      setActive(true);
    }
  }, [open, category]);

  const handleSave = async () => {
    if (!name.trim()) { onError("El nombre es requerido"); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), destination, active };
      const res = category
        ? await authFetch(`/api/admin/categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await authFetch("/api/admin/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        onSaved();
      } else {
        const err = await res.json();
        onError(err.error || "Error guardando");
      }
    } catch {
      onError("Error de conexion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#1A1A1A] border-white/10 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">{category ? "Editar categoria" : "Nueva categoria"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs text-white/40 block mb-1">Nombre *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" />
          </div>
          <div>
            <label className="text-xs text-white/40 block mb-1">Destino</label>
            <div className="flex gap-2">
              {(["COCINA", "BARRA"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDestination(d)}
                  className={cn("flex-1 py-2 rounded-xl text-sm font-medium transition-all border",
                    destination === d
                      ? d === "COCINA" ? "bg-orange-400/20 border-orange-400/50 text-orange-400" : "bg-purple-400/20 border-purple-400/50 text-purple-400"
                      : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          {category && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 rounded accent-[var(--gold)]" />
              <span className="text-sm text-white/70">Activa</span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="border-white/10 text-white/50 hover:text-white">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 font-semibold disabled:opacity-40">
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Modifier Editor Dialog ─────────────────────────────────

function ModifierEditorDialog({
  open, onClose, product, groups, onRefresh, onFlash,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  groups: ModifierGroup[];
  onRefresh: () => void;
  onFlash: (type: "ok" | "err", text: string) => void;
}) {
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [newGroupMax, setNewGroupMax] = useState(1);
  const [addingGroup, setAddingGroup] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  // Inline option add
  const [addOptionGroupId, setAddOptionGroupId] = useState<string | null>(null);
  const [newOptName, setNewOptName] = useState("");
  const [newOptPrice, setNewOptPrice] = useState("0");

  // Inline edit
  const [editingOption, setEditingOption] = useState<string | null>(null);
  const [editOptName, setEditOptName] = useState("");
  const [editOptPrice, setEditOptPrice] = useState("");

  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGrpName, setEditGrpName] = useState("");
  const [editGrpRequired, setEditGrpRequired] = useState(false);
  const [editGrpMax, setEditGrpMax] = useState(1);

  if (!product) return null;

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    setAddingGroup(true);
    const res = await authFetch(`/api/admin/products/${product.id}/modifier-groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newGroupName.trim(), required: newGroupRequired, maxSelect: newGroupMax }),
    });
    if (res.ok) {
      setNewGroupName("");
      setNewGroupRequired(false);
      setNewGroupMax(1);
      setShowNewGroup(false);
      onRefresh();
      onFlash("ok", "Grupo creado");
    } else {
      onFlash("err", "Error creando grupo");
    }
    setAddingGroup(false);
  };

  const handleAddOption = async (groupId: string) => {
    if (!newOptName.trim()) return;
    const res = await authFetch(`/api/admin/modifier-groups/${groupId}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newOptName.trim(), priceDelta: Number(newOptPrice) || 0 }),
    });
    if (res.ok) {
      setNewOptName("");
      setNewOptPrice("0");
      setAddOptionGroupId(null);
      onRefresh();
      onFlash("ok", "Opcion agregada");
    } else {
      onFlash("err", "Error agregando opcion");
    }
  };

  const handleSaveOption = async (id: string) => {
    const res = await authFetch(`/api/admin/modifier-options/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editOptName.trim(), priceDelta: Number(editOptPrice) || 0 }),
    });
    if (res.ok) {
      setEditingOption(null);
      onRefresh();
    }
  };

  const handleToggleOption = async (id: string, active: boolean) => {
    await authFetch(`/api/admin/modifier-options/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    onRefresh();
  };

  const handleSaveGroup = async (id: string) => {
    const res = await authFetch(`/api/admin/modifier-groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editGrpName.trim(), required: editGrpRequired, maxSelect: editGrpMax }),
    });
    if (res.ok) {
      setEditingGroup(null);
      onRefresh();
    }
  };

  const handleToggleGroup = async (id: string, active: boolean) => {
    await authFetch(`/api/admin/modifier-groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    onRefresh();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#1A1A1A] border-white/10 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Modificadores: {product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {groups.length === 0 && !showNewGroup && (
            <div className="text-center py-8 text-white/20">No hay grupos de modificadores</div>
          )}

          {groups.map((g) => (
            <div key={g.id} className={cn("rounded-xl border p-4", g.active ? "border-white/10 bg-white/[0.02]" : "border-white/5 bg-white/[0.01] opacity-50")}>
              {/* Group header */}
              {editingGroup === g.id ? (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <input value={editGrpName} onChange={(e) => setEditGrpName(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm flex-1 min-w-[120px]" />
                  <label className="flex items-center gap-1 text-xs text-white/50">
                    <input type="checkbox" checked={editGrpRequired} onChange={(e) => setEditGrpRequired(e.target.checked)} className="accent-[var(--gold)]" />
                    Requerido
                  </label>
                  <div className="flex items-center gap-1 text-xs text-white/50">
                    Max:
                    <input type="number" value={editGrpMax} onChange={(e) => setEditGrpMax(Number(e.target.value) || 1)} className="w-12 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs" />
                  </div>
                  <button onClick={() => handleSaveGroup(g.id)} className="text-xs text-[var(--gold)] hover:underline">Guardar</button>
                  <button onClick={() => setEditingGroup(null)} className="text-xs text-white/30 hover:text-white/50">Cancelar</button>
                </div>
              ) : (
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm">{g.name}</span>
                    {g.required && <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">Requerido</span>}
                    {g.maxSelect > 1 && <span className="text-[10px] text-white/30">Max {g.maxSelect}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditingGroup(g.id); setEditGrpName(g.name); setEditGrpRequired(g.required); setEditGrpMax(g.maxSelect); }} className="text-xs text-white/30 hover:text-white/60">Editar</button>
                    <button onClick={() => handleToggleGroup(g.id, g.active)} className={cn("text-xs", g.active ? "text-red-400/50 hover:text-red-400" : "text-emerald-400/50 hover:text-emerald-400")}>
                      {g.active ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="space-y-1">
                {g.options.map((o) => (
                  <div key={o.id} className={cn("flex items-center justify-between py-1.5 px-3 rounded-lg", !o.active && "opacity-40")}>
                    {editingOption === o.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input value={editOptName} onChange={(e) => setEditOptName(e.target.value)} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs flex-1" />
                        <input type="number" value={editOptPrice} onChange={(e) => setEditOptPrice(e.target.value)} className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs" />
                        <button onClick={() => handleSaveOption(o.id)} className="text-xs text-[var(--gold)]">OK</button>
                        <button onClick={() => setEditingOption(null)} className="text-xs text-white/30">X</button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-white/70">{o.name}</span>
                        <div className="flex items-center gap-2">
                          {o.priceDelta > 0 && <span className="text-xs text-[var(--gold)]">+{formatCRC(o.priceDelta)}</span>}
                          <button onClick={() => { setEditingOption(o.id); setEditOptName(o.name); setEditOptPrice(String(o.priceDelta)); }} className="text-[10px] text-white/20 hover:text-white/50">Editar</button>
                          <button onClick={() => handleToggleOption(o.id, o.active)} className={cn("text-[10px]", o.active ? "text-red-400/40 hover:text-red-400" : "text-emerald-400/40 hover:text-emerald-400")}>
                            {o.active ? "Desact." : "Activar"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add option */}
              {addOptionGroupId === g.id ? (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                  <input value={newOptName} onChange={(e) => setNewOptName(e.target.value)} placeholder="Nombre" className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs flex-1" />
                  <input type="number" value={newOptPrice} onChange={(e) => setNewOptPrice(e.target.value)} placeholder="Precio" className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white text-xs" />
                  <button onClick={() => handleAddOption(g.id)} className="text-xs text-[var(--gold)] hover:underline">Agregar</button>
                  <button onClick={() => setAddOptionGroupId(null)} className="text-xs text-white/30">X</button>
                </div>
              ) : (
                <button
                  onClick={() => { setAddOptionGroupId(g.id); setNewOptName(""); setNewOptPrice("0"); }}
                  className="text-xs text-white/20 hover:text-white/50 mt-2 pt-2 border-t border-white/5 block w-full text-left"
                >
                  + Agregar opcion
                </button>
              )}
            </div>
          ))}

          {/* New group form */}
          {showNewGroup ? (
            <div className="rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-4 space-y-3">
              <span className="text-sm font-medium text-white">Nuevo grupo</span>
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Nombre del grupo" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-[var(--gold)]/50" />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer">
                  <input type="checkbox" checked={newGroupRequired} onChange={(e) => setNewGroupRequired(e.target.checked)} className="accent-[var(--gold)]" />
                  Requerido
                </label>
                <div className="flex items-center gap-2 text-sm text-white/60">
                  Max seleccion:
                  <input type="number" value={newGroupMax} onChange={(e) => setNewGroupMax(Number(e.target.value) || 1)} min={1} className="w-14 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddGroup} disabled={addingGroup || !newGroupName.trim()} className="bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80 font-semibold text-sm disabled:opacity-40">
                  {addingGroup ? "Creando..." : "Crear grupo"}
                </Button>
                <Button variant="outline" onClick={() => setShowNewGroup(false)} className="border-white/10 text-white/50 text-sm">Cancelar</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewGroup(true)}
              className="w-full py-3 rounded-xl border border-dashed border-white/10 text-sm text-white/30 hover:text-white/60 hover:border-white/20 transition-colors"
            >
              + Nuevo grupo de modificadores
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
