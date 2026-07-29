import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { z } from "zod";
import { requireAuth, requireRoles } from "../middleware/auth.js";

const dateRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireRoles("ADMINISTRADOR"));

  // ══════════════════════════════════════════════════════════
  // RESUMEN GENERAL
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/dashboard/resumen", async () => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);

    const [dailySales, monthlySales, activeOrders, activeTables, totalEmployees] = await Promise.all([
      prisma.order.aggregate({
        where: { status: "CERRADA", paidAt: { gte: todayStart, lte: todayEnd } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: { status: "CERRADA", paidAt: { gte: monthStart, lte: todayEnd } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.order.count({ where: { status: "ABIERTA" } }),
      prisma.table.count({ where: { status: { not: "LIBRE" } } }),
      prisma.user.count({ where: { active: true } }),
    ]);

    const dailyAvgTicket = dailySales._count > 0
      ? Number(dailySales._sum.total || 0) / dailySales._count
      : 0;

    const monthlyAvgTicket = monthlySales._count > 0
      ? Number(monthlySales._sum.total || 0) / monthlySales._count
      : 0;

    return {
      daily: {
        sales: Number(dailySales._sum.total || 0),
        orders: dailySales._count,
        avgTicket: Math.round(dailyAvgTicket),
      },
      monthly: {
        sales: Number(monthlySales._sum.total || 0),
        orders: monthlySales._count,
        avgTicket: Math.round(monthlyAvgTicket),
      },
      live: {
        activeOrders,
        activeTables,
        totalEmployees,
      },
    };
  });

  // ══════════════════════════════════════════════════════════
  // VENTAS DIARIAS (últimos 30 días)
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/dashboard/ventas-diarias", async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orders = await prisma.order.findMany({
      where: { status: "CERRADA", paidAt: { gte: startOfDay(thirtyDaysAgo) } },
      select: { total: true, paidAt: true },
    });

    const byDay: Record<string, { sales: number; orders: number }> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const key = d.toISOString().slice(0, 10);
      byDay[key] = { sales: 0, orders: 0 };
    }

    for (const o of orders) {
      if (!o.paidAt) continue;
      const key = o.paidAt.toISOString().slice(0, 10);
      if (byDay[key]) {
        byDay[key].sales += Number(o.total);
        byDay[key].orders += 1;
      }
    }

    return Object.entries(byDay).map(([date, data]) => ({
      date,
      label: new Date(date + "T12:00:00").toLocaleDateString("es-CR", { day: "2-digit", month: "short" }),
      ...data,
    }));
  });

  // ══════════════════════════════════════════════════════════
  // VENTAS MENSUALES (últimos 12 meses)
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/dashboard/ventas-mensuales", async () => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);

    const orders = await prisma.order.findMany({
      where: { status: "CERRADA", paidAt: { gte: startOfDay(twelveMonthsAgo) } },
      select: { total: true, paidAt: true },
    });

    const byMonth: Record<string, { sales: number; orders: number }> = {};
    for (let i = 0; i < 12; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      byMonth[key] = { sales: 0, orders: 0 };
    }

    for (const o of orders) {
      if (!o.paidAt) continue;
      const key = `${o.paidAt.getFullYear()}-${String(o.paidAt.getMonth() + 1).padStart(2, "0")}`;
      if (byMonth[key]) {
        byMonth[key].sales += Number(o.total);
        byMonth[key].orders += 1;
      }
    }

    return Object.entries(byMonth).map(([month, data]) => {
      const [y, m] = month.split("-");
      const d = new Date(Number(y), Number(m) - 1, 1);
      return {
        month,
        label: d.toLocaleDateString("es-CR", { month: "short", year: "2-digit" }),
        ...data,
        avgTicket: data.orders > 0 ? Math.round(data.sales / data.orders) : 0,
      };
    });
  });

  // ══════════════════════════════════════════════════════════
  // HORAS PICO (distribución por hora del día)
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof dateRangeSchema> }>("/api/admin/dashboard/horas-pico", async (req) => {
    const q = dateRangeSchema.parse(req.query);
    const from = q.from ? new Date(q.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
    const to = q.to ? new Date(q.to) : new Date();

    const orders = await prisma.order.findMany({
      where: { status: "CERRADA", paidAt: { gte: from, lte: to } },
      select: { total: true, createdAt: true },
    });

    const byHour: Record<number, { orders: number; sales: number }> = {};
    for (let h = 0; h < 24; h++) byHour[h] = { orders: 0, sales: 0 };

    for (const o of orders) {
      const h = o.createdAt.getHours();
      byHour[h].orders += 1;
      byHour[h].sales += Number(o.total);
    }

    return Object.entries(byHour).map(([hour, data]) => ({
      hour: Number(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      ...data,
    }));
  });

  // ══════════════════════════════════════════════════════════
  // PRODUCTOS ESTRELLA (top sellers)
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof dateRangeSchema> & { limit?: string } }>(
    "/api/admin/dashboard/productos-estrella",
    async (req) => {
      const from = req.query.from ? new Date(req.query.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
      const to = req.query.to ? new Date(req.query.to) : new Date();
      const limit = Number(req.query.limit) || 15;

      const items = await prisma.orderItem.findMany({
        where: {
          order: { status: "CERRADA", paidAt: { gte: from, lte: to } },
        },
        select: {
          productId: true,
          quantity: true,
          unitPrice: true,
          product: { select: { name: true, price: true, category: { select: { name: true } } } },
        },
      });

      const productMap: Record<string, { name: string; category: string; qty: number; revenue: number }> = {};
      for (const item of items) {
        if (!item.productId || !item.product) continue;
        if (!productMap[item.productId]) {
          productMap[item.productId] = {
            name: item.product.name,
            category: item.product.category.name,
            qty: 0,
            revenue: 0,
          };
        }
        productMap[item.productId].qty += item.quantity;
        productMap[item.productId].revenue += Number(item.unitPrice) * item.quantity;
      }

      return Object.entries(productMap)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, limit);
    }
  );

  // ══════════════════════════════════════════════════════════
  // RENTABILIDAD POR MÉTODO DE PAGO
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof dateRangeSchema> }>("/api/admin/dashboard/metodos-pago", async (req) => {
    const from = req.query.from ? new Date(req.query.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const orders = await prisma.order.findMany({
      where: { status: "CERRADA", paidAt: { gte: from, lte: to } },
      select: { paymentMethod: true, total: true, subtotal: true, tax: true },
    });

    const byMethod: Record<string, { count: number; total: number; subtotal: number; tax: number }> = {};
    for (const o of orders) {
      const method = o.paymentMethod || "SIN_METODO";
      if (!byMethod[method]) byMethod[method] = { count: 0, total: 0, subtotal: 0, tax: 0 };
      byMethod[method].count += 1;
      byMethod[method].total += Number(o.total);
      byMethod[method].subtotal += Number(o.subtotal);
      byMethod[method].tax += Number(o.tax);
    }

    return Object.entries(byMethod).map(([method, data]) => ({
      method,
      ...data,
      percentage: orders.length > 0 ? Math.round((data.count / orders.length) * 100) : 0,
    }));
  });

  // ══════════════════════════════════════════════════════════
  // COMPARACIÓN MENSUAL (este mes vs anterior)
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/dashboard/comparacion-mensual", async () => {
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [thisMonth, lastMonth] = await Promise.all([
      prisma.order.aggregate({
        where: { status: "CERRADA", paidAt: { gte: thisMonthStart } },
        _sum: { total: true, tax: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: { status: "CERRADA", paidAt: { gte: lastMonthStart, lte: lastMonthEnd } },
        _sum: { total: true, tax: true },
        _count: true,
      }),
    ]);

    const thisSales = Number(thisMonth._sum.total || 0);
    const lastSales = Number(lastMonth._sum.total || 0);
    const salesChange = lastSales > 0 ? Math.round(((thisSales - lastSales) / lastSales) * 100) : 0;

    const thisAvg = thisMonth._count > 0 ? Math.round(thisSales / thisMonth._count) : 0;
    const lastAvg = lastMonth._count > 0 ? Math.round(lastSales / lastMonth._count) : 0;
    const avgChange = lastAvg > 0 ? Math.round(((thisAvg - lastAvg) / lastAvg) * 100) : 0;

    return {
      thisMonth: {
        sales: thisSales,
        orders: thisMonth._count,
        avgTicket: thisAvg,
        tax: Number(thisMonth._sum.tax || 0),
      },
      lastMonth: {
        sales: lastSales,
        orders: lastMonth._count,
        avgTicket: lastAvg,
        tax: Number(lastMonth._sum.tax || 0),
      },
      changes: { sales: salesChange, orders: thisMonth._count - lastMonth._count, avgTicket: avgChange },
    };
  });

  // ══════════════════════════════════════════════════════════
  // RENDIMIENTO DE EMPLEADOS
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof dateRangeSchema> }>("/api/admin/dashboard/rendimiento-empleados", async (req) => {
    const from = req.query.from ? new Date(req.query.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const employees = await prisma.user.findMany({
      where: { active: true, role: { name: { in: ["MESERO", "CAJERO", "ADMINISTRADOR"] } } },
      select: {
        id: true,
        name: true,
        role: { select: { name: true } },
      },
    });

    const results = [];
    for (const emp of employees) {
      const orders = await prisma.order.findMany({
        where: { waiterId: emp.id, status: "CERRADA", paidAt: { gte: from, lte: to } },
        select: { total: true, createdAt: true, paidAt: true, items: { select: { quantity: true } } },
      });

      const totalSales = orders.reduce((sum, o) => sum + Number(o.total), 0);
      const totalItems = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
      const avgTicket = orders.length > 0 ? Math.round(totalSales / orders.length) : 0;

      const avgServiceTime = orders.length > 0
        ? Math.round(
            orders
              .filter((o) => o.paidAt)
              .reduce((sum, o) => sum + (o.paidAt!.getTime() - o.createdAt.getTime()), 0) /
              orders.filter((o) => o.paidAt).length /
              60000
          )
        : 0;

      const cancellations = await prisma.auditLog.count({
        where: {
          userId: emp.id,
          action: { in: ["ELIMINAR_ITEM", "CANCELAR_ORDEN"] },
          createdAt: { gte: from, lte: to },
        },
      });

      results.push({
        id: emp.id,
        name: emp.name,
        role: emp.role.name,
        orders: orders.length,
        totalSales,
        avgTicket,
        totalItems,
        avgServiceMinutes: avgServiceTime,
        cancellations,
      });
    }

    return results.sort((a, b) => b.totalSales - a.totalSales);
  });

  // ══════════════════════════════════════════════════════════
  // CATEGORÍAS MÁS VENDIDAS
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof dateRangeSchema> }>("/api/admin/dashboard/categorias", async (req) => {
    const from = req.query.from ? new Date(req.query.from) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const items = await prisma.orderItem.findMany({
      where: { order: { status: "CERRADA", paidAt: { gte: from, lte: to } } },
      select: {
        quantity: true,
        unitPrice: true,
        product: { select: { category: { select: { id: true, name: true } } } },
      },
    });

    const catMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const item of items) {
      if (!item.product) continue;
      const cId = item.product.category.id;
      if (!catMap[cId]) catMap[cId] = { name: item.product.category.name, qty: 0, revenue: 0 };
      catMap[cId].qty += item.quantity;
      catMap[cId].revenue += Number(item.unitPrice) * item.quantity;
    }

    return Object.entries(catMap)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  });
}
