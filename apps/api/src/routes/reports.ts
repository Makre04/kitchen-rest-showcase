import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen/database";
import { requireAuth, requireRoles } from "../middleware/auth.js";

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function endOfDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireRoles("ADMINISTRADOR"));

  app.get<{ Querystring: { from: string; to: string } }>(
    "/api/admin/reportes",
    async (request, reply) => {
      const { from, to } = request.query;
      if (!from || !to) return reply.status(400).send({ error: "Se requieren fechas from y to" });

      const dateFrom = parseLocal(from);
      const dateTo = endOfDay(to);

      const [
        orders,
        salesByCategory,
        topProducts,
        employeePerformance,
        cancelledItems,
        cashSessions,
      ] = await Promise.all([
        prisma.order.findMany({
          where: {
            createdAt: { gte: dateFrom, lte: dateTo },
            status: "CERRADA",
          },
          include: {
            table: { select: { number: true } },
            waiter: { select: { name: true } },
            items: {
              include: {
                product: {
                  include: { category: { select: { name: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),

        prisma.$queryRaw`
          SELECT c.name as category,
                 COUNT(oi.id)::int as "itemCount",
                 SUM(oi.precio_unitario * oi.cantidad)::float as total
          FROM detalle_orden oi
          JOIN productos p ON oi.producto_id = p.id
          JOIN categorias c ON p.categoria_id = c.id
          JOIN ordenes o ON oi.orden_id = o.id
          WHERE o.estado = 'CERRADA'
            AND o.created_at >= ${dateFrom}
            AND o.created_at <= ${dateTo}
          GROUP BY c.name
          ORDER BY total DESC
        ` as Promise<{ category: string; itemCount: number; total: number }[]>,

        prisma.$queryRaw`
          SELECT p.nombre as name,
                 SUM(oi.cantidad)::int as "totalQty",
                 SUM(oi.precio_unitario * oi.cantidad)::float as "totalRevenue"
          FROM detalle_orden oi
          JOIN productos p ON oi.producto_id = p.id
          JOIN ordenes o ON oi.orden_id = o.id
          WHERE o.estado = 'CERRADA'
            AND o.created_at >= ${dateFrom}
            AND o.created_at <= ${dateTo}
          GROUP BY p.nombre
          ORDER BY "totalQty" DESC
          LIMIT 20
        ` as Promise<{ name: string; totalQty: number; totalRevenue: number }[]>,

        prisma.$queryRaw`
          SELECT u.name,
                 COUNT(DISTINCT o.id)::int as "orderCount",
                 SUM(o.total)::float as "totalSales",
                 (SUM(o.total) / NULLIF(COUNT(DISTINCT o.id), 0))::float as "avgTicket"
          FROM ordenes o
          JOIN usuarios u ON o.mesero_id = u.id
          WHERE o.estado = 'CERRADA'
            AND o.created_at >= ${dateFrom}
            AND o.created_at <= ${dateTo}
          GROUP BY u.name
          ORDER BY "totalSales" DESC
        ` as Promise<{ name: string; orderCount: number; totalSales: number; avgTicket: number }[]>,

        prisma.$queryRaw`
          SELECT COUNT(*)::int as total
          FROM bitacora
          WHERE accion LIKE '%ELIMINAR%'
            AND entidad = 'detalle_orden'
            AND created_at >= ${dateFrom}
            AND created_at <= ${dateTo}
        ` as Promise<{ total: number }[]>,

        prisma.cashSession.findMany({
          where: {
            openedAt: { gte: dateFrom, lte: dateTo },
          },
          include: {
            user: { select: { name: true } },
          },
          orderBy: { openedAt: "asc" },
        }),
      ]);

      const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
      const totalOrders = orders.length;
      const avgTicket = totalOrders > 0 ? totalSales / totalOrders : 0;
      const totalItems = orders.reduce((s, o) => s + o.items.reduce((si, i) => si + i.quantity, 0), 0);
      const totalCovers = orders.reduce((s, o) => s + (o.covers ?? 1), 0);
      const revenuePerCover = totalCovers > 0 ? totalSales / totalCovers : 0;

      // Payment methods from order-level paymentMethod field
      const paymentMap: Record<string, { count: number; total: number }> = {};
      for (const order of orders) {
        const method = order.paymentMethod || "SIN_METODO";
        if (!paymentMap[method]) paymentMap[method] = { count: 0, total: 0 };
        paymentMap[method].count++;
        paymentMap[method].total += Number(order.total);
      }
      const paymentMethods = Object.entries(paymentMap)
        .map(([method, data]) => ({ method, ...data }))
        .sort((a, b) => b.total - a.total);

      // Sales by day
      const salesByDay: Record<string, { date: string; orders: number; total: number; covers: number }> = {};
      for (const order of orders) {
        const day = order.createdAt.toISOString().slice(0, 10);
        if (!salesByDay[day]) salesByDay[day] = { date: day, orders: 0, total: 0, covers: 0 };
        salesByDay[day].orders++;
        salesByDay[day].total += Number(order.total);
        salesByDay[day].covers += order.covers ?? 1;
      }

      // Peak hours
      const hourCounts = new Array(24).fill(0);
      for (const order of orders) {
        hourCounts[order.createdAt.getHours()]++;
      }
      const peakHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .filter((h) => h.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const cashSummary = cashSessions.map((cs) => ({
        user: cs.user.name,
        openedAt: cs.openedAt,
        closedAt: cs.closedAt,
        openingAmount: Number(cs.openingAmount),
        closingAmount: cs.closingAmount ? Number(cs.closingAmount) : null,
        difference: cs.difference ? Number(cs.difference) : null,
      }));

      return {
        period: { from: dateFrom, to: dateTo },
        summary: {
          totalSales,
          totalOrders,
          avgTicket,
          totalItems,
          totalCovers,
          revenuePerCover,
          cancelledItems: cancelledItems[0]?.total || 0,
        },
        salesByDay: Object.values(salesByDay),
        salesByCategory,
        topProducts,
        paymentMethods,
        employeePerformance,
        peakHours,
        cashSessions: cashSummary,
      };
    }
  );
}
