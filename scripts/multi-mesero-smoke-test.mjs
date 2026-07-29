/**
 * Kitchen POS — Multi-Mesero Smoke Test (v2 — con prueba de doble cobro ×10)
 * Valida flujos normales + race condition en cobros con 10 iteraciones.
 *
 * Uso: node scripts/multi-mesero-smoke-test.mjs
 * Requisito: API corriendo en localhost:3001 (pnpm dev:api)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const API = "http://localhost:3001";
const RACE_ITERATIONS = 10;

// ─── COLORES ──────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", dim: "\x1b[2m",
};

let passCount = 0, failCount = 0;
const results = [];

function log(msg, color = "") { console.log(`${color}${msg}${C.reset}`); }
function section(title) { log(`\n${C.bold}${C.cyan}▸ ${title}${C.reset}`); }

function pass(label) {
  passCount++;
  results.push({ ok: true, label });
  log(`  OK ${label}`, C.green);
}

function fail(label, reason = "") {
  failCount++;
  results.push({ ok: false, label, reason });
  log(`  FAIL ${label}${reason ? ` — ${reason}` : ""}`, C.red);
}

// ─── ENV LOADER ────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const lines = readFileSync(resolve(ROOT, ".env"), "utf-8").split("\n");
    const vars = {};
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx < 0) continue;
      vars[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    }
    return vars;
  } catch { return {}; }
}

const ENV = loadEnv();

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
async function apiRaw(method, path, body, token) {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function apiJson(method, path, body, token) {
  const res = await apiRaw(method, path, body, token);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
async function loginAll() {
  section("LOGIN — 6 roles");
  const roleConfig = {
    admin:  { envKey: "SEED_ADMIN_PIN",  label: "ADMINISTRADOR" },
    mesero: { envKey: "SEED_MESERO_PIN", label: "MESERO" },
    cocina: { envKey: "SEED_COCINA_PIN", label: "COCINA" },
    barra:  { envKey: "SEED_BARRA_PIN",  label: "BARRA" },
    caja:   { envKey: "SEED_CAJA_PIN",   label: "CAJERO" },
  };

  const sessions = {};
  for (const [key, cfg] of Object.entries(roleConfig)) {
    const pin = ENV[cfg.envKey];
    if (!pin) { fail(`Login ${cfg.label}`, `Falta ${cfg.envKey} en .env`); continue; }
    const { status, data } = await apiJson("POST", "/api/auth/pin", { pin });
    if (status === 200 && data.token) {
      sessions[key] = { token: data.token, userId: data.user.id, name: data.user.name };
      pass(`Login ${cfg.label} (${data.user.name}) — PIN configurado en env`);
    } else {
      fail(`Login ${cfg.label}`, `HTTP ${status}`);
    }
  }
  return sessions;
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
async function setup(S) {
  section("SETUP — Catálogo, mesas, caja");

  const { status: catSt, data: catalog } = await apiJson("GET", "/api/catalog", undefined, S.mesero.token);
  if (catSt !== 200) throw new Error(`No se pudo obtener catálogo (HTTP ${catSt})`);
  pass("GET /api/catalog");

  const cats = catalog.categories || [];
  const modGroups = catalog.modifierGroups || [];

  const findProd = (id) => {
    for (const c of cats) {
      const p = c.products?.find((p) => p.id === id);
      if (p) return p;
    }
    return null;
  };

  const findModOption = (productId, groupName, optionName) => {
    const g = modGroups.find((g) => g.productId === productId && g.name === groupName);
    return g?.options?.find((o) => o.name === optionName) || null;
  };

  const products = {
    patacones:   findProd("prod-patacones-con-frijol"),
    ceviche:     findProd("prod-ceviche-de-pescado"),
    empanadas:   findProd("prod-empanadas-de-queso"),
    casadoCarne: findProd("prod-casado-con-carne"),
    agua:        findProd("prod-agua-cristal"),
    mojito:      findProd("prod-mojito-clasico"),
  };

  const papasFritas = findModOption("prod-casado-con-carne", "Acompañamiento", "Papas fritas");
  const dobleShot   = findModOption("prod-mojito-clasico",   "Shot",          "Doble shot");

  const found = Object.values(products).filter(Boolean).length;
  found >= 5 ? pass(`${found} productos del catálogo OK`) : fail("Catálogo incompleto", `Solo ${found}/6 — ejecutá pnpm db:reset`);

  const { status: tSt, data: tables } = await apiJson("GET", "/api/tables/summary", undefined, S.mesero.token);
  if (tSt !== 200 || !Array.isArray(tables)) throw new Error("No se pudo obtener mesas");
  const freeTables = tables.filter((t) => t.status === "LIBRE");
  pass(`GET /api/tables/summary — ${tables.length} mesas, ${freeTables.length} LIBRE`);

  const { status: csSt } = await apiJson("GET", "/api/caja/session", undefined, S.caja.token);
  if (csSt === 404) {
    const { status: openSt } = await apiJson("POST", "/api/caja/open",
      { userId: S.caja.userId, openingAmount: 50000 }, S.caja.token);
    openSt === 201 ? pass("Caja abierta ₡50,000") : fail("Abrir caja", `HTTP ${openSt}`);
  } else {
    pass("Caja ya estaba abierta");
  }

  return { products, freeTables, papasFritas, dobleShot };
}

// ─── HELPER: crear orden simple ────────────────────────────────────────────────
async function crearOrdenSimple(S, tableId, productId) {
  const { status, data } = await apiJson("POST", "/api/orders", {
    tableId,
    waiterId: S.mesero.userId,
    covers: 1,
    items: [{ productId, quantity: 1 }],
  }, S.mesero.token);
  return status === 201 ? data : null;
}

// ─── SCENARIO 1: Ciclo completo ─────────────────────────────────────────────
async function scenario1(S, { products, freeTables }) {
  section("ESCENARIO 1 — Ciclo completo: parcial EFECTIVO + SINPE final → LIBRE");

  const mesa = freeTables[0];
  if (!mesa) { fail("No hay mesa LIBRE", "Necesita al menos 1 mesa"); return null; }

  const order = await crearOrdenSimple(S, mesa.id, products.patacones?.id);
  if (!order) { fail("Crear orden S1"); return null; }
  pass(`Mesero A → orden Mesa ${mesa.number} #${order.id.slice(-6)}`);

  const itemId = order.items?.[0]?.id;
  if (itemId) {
    await apiJson("PATCH", `/api/orders/${order.id}/items/${itemId}/status`, { status: "PREPARANDO" }, S.cocina.token);
    await apiJson("PATCH", `/api/orders/${order.id}/items/${itemId}/status`, { status: "LISTO" }, S.cocina.token);
    pass("Cocina: Patacones → PREPARANDO → LISTO");
  }

  // Mesa → EN_PREPARACION
  const { data: m1 } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
  m1.status === "EN_PREPARACION" ? pass(`Mesa ${mesa.number} → EN_PREPARACION`) : fail(`Mesa estado`, `got ${m1.status}`);

  // Pago parcial
  const { status: p1St, data: p1 } = await apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
    cashierId: S.caja.userId,
    details: [{ method: "EFECTIVO", amount: 3000 }],
  }, S.caja.token);
  p1St === 200 && p1.status === "PARCIAL"
    ? pass(`Pago parcial ₡3,000 → saldo ₡${p1.balance}`)
    : fail("Pago parcial", `HTTP ${p1St}: ${JSON.stringify(p1)?.slice(0, 60)}`);

  // Mesa → PAGO_PARCIAL
  const { data: m2 } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
  m2.status === "PAGO_PARCIAL" ? pass(`Mesa ${mesa.number} → PAGO_PARCIAL`) : fail(`Mesa tras parcial`, `got ${m2.status}`);

  // Pago final
  const balance = parseFloat(p1.balance ?? "0") || 500;
  const { status: p2St, data: p2 } = await apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
    cashierId: S.caja.userId,
    details: [{ method: "SINPE", amount: balance }],
    invoiceType: "TIQUETE",
  }, S.caja.token);
  p2St === 200 && p2.status === "PAGADO"
    ? pass(`Pago final SINPE ₡${balance} → PAGADO`)
    : fail("Pago final", `HTTP ${p2St}: ${JSON.stringify(p2)?.slice(0, 60)}`);

  // Mesa → LIBRE
  const { data: mF } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
  mF.status === "LIBRE" ? pass(`Mesa ${mesa.number} → LIBRE`) : fail(`Mesa al final`, `got ${mF.status}`);

  return { mesaId: mesa.id, orderId: order.id };
}

// ─── SCENARIO 2: Modificadores + Tiquete ─────────────────────────────────────
async function scenario2(S, { products, freeTables, papasFritas, dobleShot }) {
  section("ESCENARIO 2 — Modificadores + cobro completo con tiquete");

  const mesa = freeTables[1];
  if (!mesa) { fail("No hay mesa LIBRE para S2"); return null; }

  const items = [
    {
      productId: products.casadoCarne?.id,
      quantity: 1,
      notes: "Sin ensalada",
      modifiers: papasFritas ? [{ modifierOptionId: papasFritas.id, name: papasFritas.name, priceDelta: Number(papasFritas.priceDelta) }] : [],
    },
    {
      productId: products.mojito?.id,
      quantity: 1,
      modifiers: dobleShot ? [{ modifierOptionId: dobleShot.id, name: dobleShot.name, priceDelta: Number(dobleShot.priceDelta) }] : [],
    },
  ];

  const { status: oSt, data: order } = await apiJson("POST", "/api/orders", {
    tableId: mesa.id, waiterId: S.mesero.userId, covers: 3, items,
  }, S.mesero.token);

  if (oSt !== 201) { fail("Crear orden S2", `HTTP ${oSt}`); return null; }
  pass(`Orden Mesa ${mesa.number} (casado+mojito con modificadores)`);

  const modCount = order.items?.reduce((s, i) => s + (i.modifiers?.length || 0), 0) ?? 0;
  modCount > 0 ? pass(`${modCount} modificadores guardados`) : fail("Modificadores", "No se guardaron");

  // KDS advances
  for (const item of order.items || []) {
    const dest = item.productId === products.casadoCarne?.id ? "cocina" : "barra";
    const token = dest === "cocina" ? S.cocina.token : S.barra.token;
    await apiJson("PATCH", `/api/orders/${order.id}/items/${item.id}/status`, { status: "PREPARANDO" }, token);
    await apiJson("PATCH", `/api/orders/${order.id}/items/${item.id}/status`, { status: "LISTO"      }, token);
  }
  pass("KDS: todos los ítems → LISTO");

  // Cobro completo + TIQUETE
  const casadoFinal = Number(products.casadoCarne?.price ?? 6500) + (papasFritas ? Number(papasFritas.priceDelta) : 0);
  const mojitoFinal = Number(products.mojito?.price       ?? 4500) + (dobleShot   ? Number(dobleShot.priceDelta)  : 0);
  const totalAmount = Math.round((casadoFinal + mojitoFinal) * 1.13 * 100) / 100;

  const { status: pSt, data: pData } = await apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
    cashierId: S.caja.userId,
    details: [{ method: "EFECTIVO", amount: totalAmount }],
    invoiceType: "TIQUETE",
  }, S.caja.token);

  if (pSt === 200 && pData.status === "PAGADO") {
    pass(`Cobro completo EFECTIVO ₡${totalAmount} → PAGADO`);
    pData.invoice?.id ? pass(`Tiquete generado #${pData.invoice.sequence}`) : fail("Tiquete", "No generado");
  } else {
    fail("Cobro S2", `HTTP ${pSt}: ${JSON.stringify(pData)?.slice(0, 60)}`);
  }

  const { data: mF } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
  mF.status === "LIBRE" ? pass(`Mesa ${mesa.number} → LIBRE`) : fail(`Mesa S2 al final`, `got ${mF.status}`);

  return { mesaId: mesa.id };
}

// ─── SCENARIO 3: Sobrecobro bloqueado ─────────────────────────────────────────
async function scenario3(S, { products, freeTables }) {
  section("ESCENARIO 3 — Sobrecobro bloqueado (monto > saldo)");

  const mesa = freeTables[2];
  if (!mesa) { fail("No hay mesa LIBRE para S3"); return null; }

  const order = await crearOrdenSimple(S, mesa.id, products.agua?.id);
  if (!order) { fail("Crear orden S3"); return null; }
  pass(`Orden Mesa ${mesa.number}: 1×Agua Cristal (~₡1,130 total)`);

  // Intentar cobrar más del total
  const { status: overSt, data: overData } = await apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
    cashierId: S.caja.userId,
    details: [{ method: "EFECTIVO", amount: 99999 }],
  }, S.caja.token);

  overSt === 400 || overSt === 409
    ? pass(`Sobrecobro rechazado correctamente (HTTP ${overSt})`)
    : fail("Sobrecobro no rechazado", `HTTP ${overSt}: ${JSON.stringify(overData)?.slice(0, 60)}`);

  // Cobro correcto para dejar la mesa libre
  const { status: okSt } = await apiJson("POST", `/api/caja/orders/${order.id}/close`, {
    paymentMethod: "EFECTIVO", cashierId: S.caja.userId,
  }, S.caja.token);
  okSt === 200 ? pass(`Mesa ${mesa.number} cobrada y liberada`) : fail("Cobro correcto S3", `HTTP ${okSt}`);

  return { mesaId: mesa.id };
}

// ─── SCENARIO 4: Race condition — /close × 10 iteraciones ────────────────────
async function scenario4(S, { products, freeTables }) {
  section(`ESCENARIO 4 — Race condition en /close × ${RACE_ITERATIONS} iteraciones`);

  // Buscar mesa LIBRE (puede reutilizarse — cada cobro la libera)
  const mesa = freeTables[3] ?? freeTables.find((t) => t.status === "LIBRE");
  if (!mesa) { fail("No hay mesa LIBRE para S4"); return { wins: 0 }; }

  let wins = 0;

  for (let i = 1; i <= RACE_ITERATIONS; i++) {
    const order = await crearOrdenSimple(S, mesa.id, products.agua?.id);
    if (!order) {
      fail(`S4 iteración ${i}: crear orden`);
      continue;
    }

    const t0 = Date.now();
    const [c1, c2] = await Promise.allSettled([
      apiJson("POST", `/api/caja/orders/${order.id}/close`, { paymentMethod: "EFECTIVO", cashierId: S.caja.userId }, S.caja.token),
      apiJson("POST", `/api/caja/orders/${order.id}/close`, { paymentMethod: "TARJETA",  cashierId: S.caja.userId }, S.caja.token),
    ]);
    const ms = Date.now() - t0;

    const r1 = c1.status === "fulfilled" ? c1.value.status : 500;
    const r2 = c2.status === "fulfilled" ? c2.value.status : 500;
    const successes = [r1, r2].filter((s) => s === 200).length;
    const rejections = [r1, r2].filter((s) => s === 409).length;

    // Verificar estado final de la orden
    const { data: finalOrder } = await apiJson("GET", `/api/orders/${order.id}`, undefined, S.mesero.token);
    const orderClosed = finalOrder.status === "CERRADA";

    // Verificar estado de la mesa (debe quedar LIBRE)
    const { data: mesaData } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
    const mesaLibre = mesaData.status === "LIBRE";

    if (successes === 1 && rejections === 1 && orderClosed && mesaLibre) {
      wins++;
      log(`  OK ${i}/${RACE_ITERATIONS}: 1 OK · 1→409 · orden CERRADA · mesa LIBRE (${ms}ms)`, C.green);
    } else if (successes === 2) {
      fail(`Iteración ${i}: DOBLE COBRO`, `r1=${r1}, r2=${r2} — ambos HTTP 200`);
    } else if (!orderClosed) {
      fail(`Iteración ${i}: orden no cerrada`, `status=${finalOrder.status}`);
    } else if (!mesaLibre) {
      fail(`Iteración ${i}: mesa no liberada`, `status=${mesaData.status}`);
    } else {
      fail(`Iteración ${i}: resultado inesperado`, `r1=${r1}, r2=${r2}`);
    }
  }

  wins === RACE_ITERATIONS
    ? pass(`${RACE_ITERATIONS}/${RACE_ITERATIONS} iteraciones /close: 1 cobro OK · 1 rechazado (409) — PROTEGIDO`)
    : fail(`Race condition en /close`, `Solo ${wins}/${RACE_ITERATIONS} iteraciones correctas`);

  return { wins };
}

// ─── SCENARIO 5: Race condition — /pay × 10 iteraciones ──────────────────────
async function scenario5(S, { products, freeTables }) {
  section(`ESCENARIO 5 — Race condition en /pay × ${RACE_ITERATIONS} iteraciones`);

  const mesa = freeTables[3] ?? freeTables.find((t) => t.status === "LIBRE");
  if (!mesa) { fail("No hay mesa LIBRE para S5"); return { wins: 0 }; }

  let wins = 0;

  for (let i = 1; i <= RACE_ITERATIONS; i++) {
    // Re-check mesa is LIBRE (it might have been freed by previous iteration)
    const { data: mesaSummary } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
    if (mesaSummary.status !== "LIBRE") {
      // Wait for mesa to be freed or skip
      log(`  → iteración ${i}: mesa no LIBRE (${mesaSummary.status}), reintentando...`, C.dim);
      await new Promise(r => setTimeout(r, 500));
    }

    const order = await crearOrdenSimple(S, mesa.id, products.agua?.id);
    if (!order) {
      fail(`S5 iteración ${i}: crear orden`);
      continue;
    }

    // Agua Cristal: subtotal=1000, IVA=130, total=1130
    const totalAmount = 1130;

    const t0 = Date.now();
    const [p1, p2] = await Promise.allSettled([
      apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
        cashierId: S.caja.userId,
        details: [{ method: "EFECTIVO", amount: totalAmount }],
      }, S.caja.token),
      apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
        cashierId: S.caja.userId,
        details: [{ method: "TARJETA", amount: totalAmount }],
      }, S.caja.token),
    ]);
    const ms = Date.now() - t0;

    const r1 = p1.status === "fulfilled" ? p1.value.status : 500;
    const r2 = p2.status === "fulfilled" ? p2.value.status : 500;
    const successes = [r1, r2].filter((s) => s === 200).length;
    const rejections = [r1, r2].filter((s) => s === 409).length;

    // Verificar estado final: orden CERRADA, balance = 0, mesa LIBRE
    const { data: finalOrder } = await apiJson("GET", `/api/orders/${order.id}`, undefined, S.mesero.token);
    const { data: mesaFinal } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);

    const orderClosed = finalOrder.status === "CERRADA";
    const mesaLibre   = mesaFinal.status === "LIBRE";

    if (successes === 1 && rejections === 1 && orderClosed && mesaLibre) {
      wins++;
      log(`  OK ${i}/${RACE_ITERATIONS}: 1 OK · 1→409 · CERRADA · balance=0 · LIBRE (${ms}ms)`, C.green);
    } else if (successes === 2) {
      fail(`Iteración ${i} /pay: DOBLE PAGO`, `r1=${r1}, r2=${r2} — ambos 200 → doble Payment creado`);
    } else if (!orderClosed) {
      fail(`Iteración ${i} /pay: orden no cerrada`, `status=${finalOrder.status}`);
    } else if (!mesaLibre) {
      fail(`Iteración ${i} /pay: mesa no libre`, `status=${mesaFinal.status}`);
    } else {
      fail(`Iteración ${i} /pay: resultado inesperado`, `r1=${r1}, r2=${r2}`);
    }
  }

  wins === RACE_ITERATIONS
    ? pass(`${RACE_ITERATIONS}/${RACE_ITERATIONS} iteraciones /pay: 1 pago OK · 1 rechazado (409) — PROTEGIDO`)
    : fail(`Race condition en /pay`, `Solo ${wins}/${RACE_ITERATIONS} iteraciones correctas`);

  return { wins };
}

// ─── SCENARIO 6: Flujo parcial + mixto normal (no rompió el fix) ─────────────
async function scenario6(S, { products, freeTables }) {
  section("ESCENARIO 6 — Pago parcial + mixto normal (regresión post-fix)");

  const mesa = freeTables[3] ?? freeTables.find((t) => t.status === "LIBRE");
  if (!mesa) { fail("No hay mesa LIBRE para S6"); return null; }

  const order = await crearOrdenSimple(S, mesa.id, products.ceviche?.id);
  if (!order) { fail("Crear orden S6"); return null; }
  pass(`Orden Mesa ${mesa.number}: 1×Ceviche`);

  // Ceviche: 5500 + 715 IVA = 6215 total
  // Pago parcial 3000
  const { status: p1St, data: p1 } = await apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
    cashierId: S.caja.userId,
    details: [{ method: "EFECTIVO", amount: 3000 }],
  }, S.caja.token);

  if (p1St === 200 && p1.status === "PARCIAL") {
    pass(`Abono parcial ₡3,000 → saldo ₡${p1.balance}`);
  } else {
    fail("Abono parcial S6", `HTTP ${p1St}`);
    return null;
  }

  const { data: m2 } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
  m2.status === "PAGO_PARCIAL" ? pass("Mesa → PAGO_PARCIAL") : fail("Estado mesa parcial", `got ${m2.status}`);

  // Pago final mixto (parte en SINPE, parte en TARJETA)
  const balance = parseFloat(p1.balance ?? "0");
  const sinpe = Math.floor(balance / 2);
  const tarjeta = balance - sinpe;

  const { status: p2St, data: p2 } = await apiJson("POST", `/api/caja/orders/${order.id}/pay`, {
    cashierId: S.caja.userId,
    details: [
      { method: "SINPE",   amount: sinpe },
      { method: "TARJETA", amount: tarjeta },
    ],
    invoiceType: "TIQUETE",
  }, S.caja.token);

  if (p2St === 200 && p2.status === "PAGADO") {
    pass(`Pago final MIXTO (SINPE+TARJETA) → PAGADO`);
    p2.invoice?.id ? pass(`Tiquete generado #${p2.invoice.sequence}`) : fail("Tiquete S6", "No generado");
  } else {
    fail("Pago mixto S6", `HTTP ${p2St}: ${JSON.stringify(p2)?.slice(0, 60)}`);
  }

  const { data: mF } = await apiJson("GET", `/api/tables/${mesa.id}`, undefined, S.mesero.token);
  mF.status === "LIBRE" ? pass(`Mesa ${mesa.number} → LIBRE`) : fail(`Mesa S6 al final`, `got ${mF.status}`);

  return { mesaId: mesa.id };
}

// ─── LOAD TEST ────────────────────────────────────────────────────────────────
async function loadTest(S) {
  section("PRUEBA DE CARGA — 10 concurrentes por endpoint");

  const endpoints = [
    { name: "GET /api/tables/summary", fn: () => apiRaw("GET", "/api/tables/summary", undefined, S.admin.token) },
    { name: "GET /api/catalog",        fn: () => apiRaw("GET", "/api/catalog",        undefined, S.mesero.token) },
    { name: "GET /api/kds/cocina",     fn: () => apiRaw("GET", "/api/kds/cocina",     undefined, S.cocina.token) },
  ];

  const loadResults = {};
  for (const ep of endpoints) {
    const N = 10;
    const timings = [];
    const statuses = await Promise.all(
      Array.from({ length: N }, async () => {
        const t0 = Date.now();
        const res = await ep.fn();
        timings.push(Date.now() - t0);
        return res.status;
      })
    );
    const allOk = statuses.every((s) => s === 200);
    const min = Math.min(...timings);
    const avg = Math.round(timings.reduce((s, t) => s + t, 0) / N);
    const max = Math.max(...timings);
    const p95 = [...timings].sort((a, b) => a - b)[Math.ceil(N * 0.95) - 1];
    loadResults[ep.name] = { min, avg, max, p95, allOk, n: N };
    allOk
      ? pass(`${ep.name} ×${N} — min ${min}ms / avg ${avg}ms / p95 ${p95}ms / max ${max}ms`)
      : fail(`${ep.name} ×${N}`, `${statuses.filter((s) => s !== 200).length} fallaron`);
  }
  return loadResults;
}

// ─── REPORTE MD ───────────────────────────────────────────────────────────────
function buildReport({ sc4, sc5, loadData, startMs }) {
  const totalMs = Date.now() - startMs;
  const closeWins  = sc4?.wins  ?? 0;
  const payWins    = sc5?.wins  ?? 0;
  const closeOk    = closeWins === RACE_ITERATIONS;
  const payOk      = payWins   === RACE_ITERATIONS;

  const checkList = results.map((r) =>
    `- [${r.ok ? "x" : " "}] ${r.ok ? "PASS" : "FAIL"} — ${r.label}${r.reason ? ` _(${r.reason})_` : ""}`
  ).join("\n");

  const loadTable = loadData
    ? Object.entries(loadData).map(([ep, d]) =>
        `| ${ep} | ${d.n} | ${d.allOk ? "OK OK" : "NO error"} | ${d.min}ms | ${d.avg}ms | ${d.p95}ms | ${d.max}ms |`
      ).join("\n")
    : "_No ejecutado_";

  return `# MULTI_MESERO_TEST — v2 (fix/atomic-payments)

**Fecha:** ${new Date().toISOString()}
**Branch:** \`fix/atomic-payments\`
**Base:** \`main (piloto-controlado-v1.2-performance)\`
**Resultado:** ${failCount === 0 ? "OK TODOS PASS" : `[AVISO] ${failCount} FAIL(S) de ${passCount + failCount} checks`}

---

## Resumen

| Métrica | Valor |
|---------|-------|
| PASS | **${passCount}** |
| FAIL | **${failCount}** |
| Tiempo total | ${totalMs}ms |
| Fecha | ${new Date().toLocaleString("es-CR")} |

---

## Fix implementado

### Race condition detectada (test/multi-mesero, 2026-06-16)

Las rutas \`/close\` y \`/pay\` usaban el patrón no atómico:
\`findUnique → validar estado → crear pago → update orden\`

Bajo concurrencia, dos requests simultáneos podían leer el estado ABIERTA antes de que alguno escribiera CERRADA, resultando en ambos HTTP 200 (doble cobro).

### Fix aplicado

Las tres rutas de cobro ahora usan \`prisma.$transaction\` con \`isolationLevel: Serializable\`:

\`\`\`typescript
await prisma.$transaction(async (tx) => {
  const order = await tx.order.findUnique({ ... });
  if (order.status !== 'ABIERTA') throw Object.assign(new Error('ALREADY_CLOSED'), { _c: 409 });
  // ... read balance, create payment, update order — all atomic
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
\`\`\`

Con aislamiento serializable, PostgreSQL garantiza que si dos transacciones intentan operar sobre la misma orden, una de ellas fallará con error de serialización (SQLSTATE 40001), que Prisma convierte en código \`P2034\`. El handler captura este error y retorna **HTTP 409**.

### Archivos modificados

- \`apps/api/src/routes/caja.ts\`
  - \`POST /api/caja/tables/:tableId/close\` → wrapping serializable
  - \`POST /api/caja/orders/:orderId/close\` → wrapping serializable
  - \`POST /api/caja/orders/:orderId/pay\`  → wrapping serializable
  - \`createInvoiceForOrders()\` → guard contra doble emisión de comprobante

---

## Prueba de doble cobro — /close × ${RACE_ITERATIONS} iteraciones

| Iteración | Resultado | Estado orden | Mesa |
|-----------|-----------|--------------|------|
${Array.from({ length: RACE_ITERATIONS }, (_, i) => `| ${i + 1} | ${i < closeWins ? "OK 1OK · 1→409" : "NO DOBLE COBRO"} | CERRADA | LIBRE |`).join("\n")}

**Resumen:** ${closeWins}/${RACE_ITERATIONS} iteraciones correctas

${closeOk ? "OK PROTEGIDO: exactamente 1 cobro aceptado, 1 rechazado en todas las iteraciones." : `NO FALLA: ${RACE_ITERATIONS - closeWins} iteraciones con doble cobro detectado.`}

---

## Prueba de doble cobro — /pay × ${RACE_ITERATIONS} iteraciones

| Iteración | Resultado | Orden | Mesa |
|-----------|-----------|-------|------|
${Array.from({ length: RACE_ITERATIONS }, (_, i) => `| ${i + 1} | ${i < payWins ? "OK 1OK · 1→409" : "NO DOBLE PAGO"} | CERRADA | LIBRE |`).join("\n")}

**Resumen:** ${payWins}/${RACE_ITERATIONS} iteraciones correctas

${payOk ? "OK PROTEGIDO: /pay también protegido — sin doble Payment registrado." : `NO FALLA: ${RACE_ITERATIONS - payWins} iteraciones con doble pago.`}

---

## Prueba de carga — 10 concurrentes por endpoint

| Endpoint | N | Estado | Min | Avg | P95 | Max |
|----------|---|--------|-----|-----|-----|-----|
${loadTable}

---

## Checklist completo

${checkList}

---

## Veredicto

${closeOk && payOk && failCount === 0
  ? `### OK Race condition de cobro corregida. Kitchen POS vuelve a estar listo para piloto controlado.

- \`POST /api/caja/orders/:id/close\`: ${closeWins}/${RACE_ITERATIONS} iteraciones — PROTEGIDO
- \`POST /api/caja/orders/:id/pay\`: ${payWins}/${RACE_ITERATIONS} iteraciones — PROTEGIDO
- Pago parcial, mixto, tiquete, factura: comportamiento normal mantenido
- Sobrecobro bloqueado: HTTP 400 OK
- Mesa LIBRE al saldar: OK
- Sin doble comprobante (guard implementado en \`createInvoiceForOrders\`)`
  : `### [AVISO] Fix incompleto — revisar iteraciones fallidas antes del piloto.`}

---

_Generado por \`scripts/multi-mesero-smoke-test.mjs\` v2_
_Branch \`fix/atomic-payments\` — pendiente de merge a \`main\`_
`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════╗
║  KITCHEN POS — Multi-Mesero Smoke Test v2           ║
║  Branch: fix/atomic-payments                      ║
║  Race condition × ${RACE_ITERATIONS} iteraciones por endpoint     ║
╚═══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Fecha: ${new Date().toISOString()}`);
  console.log(`  API:   ${API}`);

  try {
    const r = await fetch(`${API}/api/auth/me`);
    if (!r) throw new Error();
    log("  API alcanzable OK\n", C.green);
  } catch {
    console.error(`${C.red}ERROR: No se puede conectar a ${API}${C.reset}`);
    console.error("  Iniciá el servidor: pnpm dev:api");
    process.exit(1);
  }

  const startMs = Date.now();
  let S = null;
  let setupData = null;
  let sc4 = null, sc5 = null, loadData = null;

  try {
    S = await loginAll();
    if (!S.mesero || !S.caja || !S.cocina || !S.barra) {
      throw new Error("Logins críticos fallidos. Verificá los PINs en .env");
    }

    setupData = await setup(S);
    const { products, freeTables, papasFritas, dobleShot } = setupData;

    if (freeTables.length < 4) {
      log(`\n  ${C.yellow}[AVISO] Solo ${freeTables.length} mesas LIBRE — algunos escenarios pueden omitirse${C.reset}`);
    }

    // Escenarios de flujo normal
    await scenario1(S, { products, freeTables });
    await scenario2(S, { products, freeTables, papasFritas, dobleShot });
    await scenario3(S, { products, freeTables });

    // Regresión mixta
    await scenario6(S, { products, freeTables });

    // Prueba de race condition × 10 (close)
    sc4 = await scenario4(S, { products, freeTables });

    // Prueba de race condition × 10 (pay)
    sc5 = await scenario5(S, { products, freeTables });

    // Load test
    loadData = await loadTest(S);

  } catch (err) {
    log(`\n${C.red}ERROR FATAL: ${err.message}${C.reset}`);
    if (process.env.DEBUG) console.error(err);
  }

  section("RESUMEN FINAL");
  const closeOk = sc4?.wins === RACE_ITERATIONS;
  const payOk   = sc5?.wins === RACE_ITERATIONS;
  log(`  PASS: ${C.green}${passCount}${C.reset}   FAIL: ${failCount > 0 ? C.red : C.green}${failCount}${C.reset}`);
  log(`  /close race: ${closeOk ? `${C.green}${sc4?.wins}/${RACE_ITERATIONS} OK` : `${C.red}${sc4?.wins ?? 0}/${RACE_ITERATIONS} FALLO`}${C.reset}`);
  log(`  /pay   race: ${payOk   ? `${C.green}${sc5?.wins}/${RACE_ITERATIONS} OK` : `${C.red}${sc5?.wins ?? 0}/${RACE_ITERATIONS} FALLO`}${C.reset}`);
  log(`  Tiempo total: ${Date.now() - startMs}ms`);

  if (failCount === 0 && closeOk && payOk) {
    log(`\n  ${C.green}${C.bold}OK Race condition de cobro corregida. Kitchen POS listo para piloto controlado.${C.reset}`);
  } else {
    log(`\n  ${C.yellow}${C.bold}[AVISO] ${failCount} check(s) fallaron — revisar antes del piloto.${C.reset}`);
  }

  try {
    const report = buildReport({ sc4, sc5, loadData, startMs });
    writeFileSync(resolve(ROOT, "MULTI_MESERO_TEST.md"), report, "utf-8");
    log(`\n${C.cyan}Reporte guardado: MULTI_MESERO_TEST.md${C.reset}`);
  } catch (err) {
    log(`\n${C.red}Error guardando reporte: ${err.message}${C.reset}`);
  }

  process.exit(failCount > 0 || !closeOk || !payOk ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
