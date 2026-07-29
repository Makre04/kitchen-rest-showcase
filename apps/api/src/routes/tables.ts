import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { z } from "zod";
import { compare } from "bcryptjs";
import { requireAuth } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";

const updateStatusSchema = z.object({
  status: z.enum([
    "LIBRE",
    "OCUPADA",
    "ESPERANDO_PEDIDO",
    "EN_PREPARACION",
    "PENDIENTE_PAGO",
  ]),
});

const mergeTablesSchema = z.object({
  sourceTableId: z.string().min(1),
  targetTableId: z.string().min(1),
});

const transferItemsSchema = z.object({
  sourceTableId: z.string().min(1),
  targetTableId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
});

const deleteItemSchema = z.object({
  adminPin: z.string().min(4),
  reason: z.string().optional(),
});

const splitBillSchema = z.object({
  orderId: z.string().min(1),
  groups: z.array(z.array(z.string().min(1)).min(1)).min(2),
});

export async function tableRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Lightweight summary for polling — no items, no modifiers, no full payment records
  app.get("/api/tables/summary", async () => {
    const tables = await prisma.table.findMany({
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        capacity: true,
        status: true,
        orders: {
          where: { status: "ABIERTA" },
          select: {
            id: true,
            covers: true,
            waiter: { select: { id: true, name: true } },
            _count: { select: { items: true } },
            payments: { select: { id: true, paidAmount: true, status: true } },
          },
        },
      },
    });

    return tables.map((t) => {
      const orders = t.orders;
      const itemCount = orders.reduce((s, o) => s + o._count.items, 0);
      const hasPartialPayment = orders.some((o) =>
        o.payments.some((p) => p.status === "PARCIAL")
      );
      return {
        id: t.id,
        number: t.number,
        capacity: t.capacity,
        status: t.status,
        orderCount: orders.length,
        itemCount,
        hasPartialPayment,
        waiterName: orders[0]?.waiter?.name ?? null,
        covers: orders[0]?.covers ?? null,
        orders: orders.map((o) => ({ id: o.id, covers: o.covers, waiter: o.waiter })),
      };
    });
  });

  // Full detail for a single table (loaded on demand when opening dialog)
  app.get<{ Params: { id: string } }>("/api/tables/:id", async (request, reply) => {
    const table = await prisma.table.findUnique({
      where: { id: request.params.id },
      include: {
        orders: {
          where: { status: "ABIERTA" },
          include: {
            waiter: { select: { id: true, name: true } },
            items: {
              include: {
                product: { select: { id: true, name: true, price: true } },
                modifiers: true,
              },
              orderBy: { id: "asc" },
            },
            payments: {
              select: { id: true, paidAmount: true, status: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!table) return reply.status(404).send({ error: "Mesa no encontrada" });
    return table;
  });

  // Full list with all relations (kept for backwards compat — prefer /summary for polling)
  app.get("/api/tables", async () => {
    return prisma.table.findMany({
      orderBy: { number: "asc" },
      include: {
        orders: {
          where: { status: "ABIERTA" },
          select: {
            id: true,
            covers: true,
            waiter: { select: { id: true, name: true } },
            items: {
              include: {
                product: { select: { id: true, name: true, price: true } },
                modifiers: true,
              },
            },
            payments: {
              select: { id: true, paidAmount: true, status: true, createdAt: true },
            },
          },
        },
      },
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof updateStatusSchema> }>(
    "/api/tables/:id/status",
    async (request, reply) => {
      const parsed = updateStatusSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const table = await prisma.table.update({
        where: { id: request.params.id },
        data: { status: parsed.data.status },
      });

      await auditLog(request, "CAMBIAR_ESTADO_MESA", "mesa", request.params.id, { status: parsed.data.status });
      return table;
    }
  );

  // Merge tables: move all orders from source to target
  app.post<{ Body: z.infer<typeof mergeTablesSchema> }>(
    "/api/tables/merge",
    async (request, reply) => {
      const parsed = mergeTablesSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Datos inválidos" });

      const { sourceTableId, targetTableId } = parsed.data;
      if (sourceTableId === targetTableId) {
        return reply.status(400).send({ error: "No se puede unir una mesa consigo misma" });
      }

      const sourceOrders = await prisma.order.findMany({
        where: { tableId: sourceTableId, status: "ABIERTA" },
      });

      if (sourceOrders.length === 0) {
        return reply.status(400).send({ error: "La mesa origen no tiene órdenes abiertas" });
      }

      const targetOrder = await prisma.order.findFirst({
        where: { tableId: targetTableId, status: "ABIERTA" },
      });

      await prisma.$transaction(async (tx) => {
        if (targetOrder) {
          for (const order of sourceOrders) {
            await tx.orderItem.updateMany({
              where: { orderId: order.id },
              data: { orderId: targetOrder.id },
            });
            await tx.order.delete({ where: { id: order.id } });
          }
        } else {
          for (const order of sourceOrders) {
            await tx.order.update({
              where: { id: order.id },
              data: { tableId: targetTableId },
            });
          }
        }

        await tx.table.update({
          where: { id: sourceTableId },
          data: { status: "LIBRE" },
        });

        const targetTable = await tx.table.findUnique({ where: { id: targetTableId } });
        if (targetTable && targetTable.status === "LIBRE") {
          await tx.table.update({
            where: { id: targetTableId },
            data: { status: "EN_PREPARACION" },
          });
        }
      });

      await auditLog(request, "UNIR_MESAS", "mesa", targetTableId, { sourceTableId });
      return { success: true };
    }
  );

  // Transfer items between tables
  app.post<{ Body: z.infer<typeof transferItemsSchema> }>(
    "/api/tables/transfer-items",
    async (request, reply) => {
      const parsed = transferItemsSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Datos inválidos" });

      const { sourceTableId, targetTableId, itemIds } = parsed.data;

      const targetOrder = await prisma.order.findFirst({
        where: { tableId: targetTableId, status: "ABIERTA" },
      });

      const sourceOrder = await prisma.order.findFirst({
        where: { tableId: sourceTableId, status: "ABIERTA" },
        include: { items: true },
      });

      if (!sourceOrder) {
        return reply.status(400).send({ error: "La mesa origen no tiene órdenes" });
      }

      const srcPayCount = await prisma.payment.count({ where: { orderId: sourceOrder.id } });
      if (srcPayCount > 0) {
        return reply.status(409).send({ error: "No se pueden mover items de una cuenta con abonos" });
      }

      await prisma.$transaction(async (tx) => {
        let destOrderId: string;

        if (targetOrder) {
          destOrderId = targetOrder.id;
        } else {
          const newOrder = await tx.order.create({
            data: {
              tableId: targetTableId,
              waiterId: sourceOrder.waiterId,
              status: "ABIERTA",
            },
          });
          destOrderId = newOrder.id;
          await tx.table.update({
            where: { id: targetTableId },
            data: { status: "EN_PREPARACION" },
          });
        }

        await tx.orderItem.updateMany({
          where: { id: { in: itemIds }, orderId: sourceOrder.id },
          data: { orderId: destOrderId },
        });

        const remaining = await tx.orderItem.count({
          where: { orderId: sourceOrder.id },
        });

        if (remaining === 0) {
          await tx.order.delete({ where: { id: sourceOrder.id } });
          await tx.table.update({
            where: { id: sourceTableId },
            data: { status: "LIBRE" },
          });
        }
      });

      await auditLog(request, "TRANSFERIR_ITEMS", "mesa", targetTableId, { sourceTableId, itemIds });
      return { success: true };
    }
  );

  // Delete item with admin PIN verification
  app.post<{ Params: { orderId: string; itemId: string }; Body: z.infer<typeof deleteItemSchema> }>(
    "/api/orders/:orderId/items/:itemId/delete",
    async (request, reply) => {
      const parsed = deleteItemSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "PIN requerido" });

      const admins = await prisma.user.findMany({
        where: { active: true, role: { name: "ADMINISTRADOR" } },
      });

      let authorized = false;
      for (const admin of admins) {
        if (await compare(parsed.data.adminPin, admin.pin)) {
          authorized = true;
          break;
        }
      }

      if (!authorized) {
        return reply.status(403).send({ error: "PIN de administrador incorrecto" });
      }

      const item = await prisma.orderItem.findUnique({
        where: { id: request.params.itemId },
        include: { product: true },
      });

      if (!item || item.orderId !== request.params.orderId) {
        return reply.status(404).send({ error: "Item no encontrado" });
      }

      await prisma.orderItem.delete({ where: { id: request.params.itemId } });

      const remaining = await prisma.orderItem.count({
        where: { orderId: request.params.orderId },
      });

      if (remaining === 0) {
        const order = await prisma.order.findUnique({ where: { id: request.params.orderId } });
        await prisma.order.delete({ where: { id: request.params.orderId } });
        if (order) {
          const otherOrders = await prisma.order.count({
            where: { tableId: order.tableId, status: "ABIERTA" },
          });
          if (otherOrders === 0) {
            await prisma.table.update({
              where: { id: order.tableId },
              data: { status: "LIBRE" },
            });
          }
        }
      }

      await auditLog(request, "ELIMINAR_ITEM", "detalle_orden", request.params.itemId, {
        product: item.product?.name || item.customName || "Producto abierto",
        reason: parsed.data.reason || "Sin motivo",
      });

      return { success: true };
    }
  );

  // Split bill: divide order items into separate orders on same table
  app.post<{ Body: z.infer<typeof splitBillSchema> }>(
    "/api/tables/split-bill",
    async (request, reply) => {
      const parsed = splitBillSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Datos inválidos" });

      const { orderId, groups } = parsed.data;
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order || order.status !== "ABIERTA") {
        return reply.status(400).send({ error: "Orden no encontrada o no está abierta" });
      }

      const payCount = await prisma.payment.count({ where: { orderId: order.id } });
      if (payCount > 0) {
        return reply.status(409).send({ error: "No se puede dividir una cuenta con abonos registrados" });
      }

      await prisma.$transaction(async (tx) => {
        // First group keeps original order
        // Additional groups get new orders
        for (let i = 1; i < groups.length; i++) {
          const newOrder = await tx.order.create({
            data: {
              tableId: order.tableId,
              waiterId: order.waiterId,
              status: "ABIERTA",
            },
          });

          await tx.orderItem.updateMany({
            where: { id: { in: groups[i] }, orderId: order.id },
            data: { orderId: newOrder.id },
          });
        }
      });

      await auditLog(request, "DIVIDIR_CUENTA", "orden", orderId, { groups: groups.length });
      return { success: true };
    }
  );
}
