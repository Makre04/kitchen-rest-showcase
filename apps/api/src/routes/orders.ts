import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen/database";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";

const modifierSelection = z.object({
  modifierOptionId: z.string().optional(),
  name: z.string().min(1),
  priceDelta: z.number().default(0),
});

const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
  notes: z.string().optional(),
  modifiers: z.array(modifierSelection).optional(),
});

const createOrderSchema = z.object({
  tableId: z.string().min(1),
  waiterId: z.string().min(1),
  covers: z.number().int().min(1).default(1),
  items: z.array(orderItemSchema).min(1),
});

const addItemsSchema = z.object({
  items: z.array(orderItemSchema).min(1),
});

const openItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().min(0),
  destination: z.enum(["COCINA", "BARRA"]),
  quantity: z.number().int().min(1).default(1),
  notes: z.string().optional(),
  createdBy: z.string().min(1),
});

const updateItemStatusSchema = z.object({
  status: z.enum(["PENDIENTE", "PREPARANDO", "LISTO", "ENTREGADO"]),
});

const ORDER_STATUSES = ["ABIERTA", "CERRADA", "CANCELADA"] as const;
type OrderStatusFilter = (typeof ORDER_STATUSES)[number];

export async function orderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.post<{ Body: z.infer<typeof createOrderSchema> }>(
    "/api/orders",
    async (request, reply) => {
      const parsed = createOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const { tableId, waiterId, covers, items } = parsed.data;

      const products = await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      // Reject stale/unknown products (e.g. cached catalog after admin removed one)
      const missing = items.filter((i) => !productMap.has(i.productId));
      if (missing.length > 0) {
        return reply.status(400).send({
          error: "Uno o más productos ya no están disponibles. Actualice el menú.",
        });
      }

      const order = await prisma.order.create({
        data: {
          tableId,
          waiterId,
          covers,
          status: "ABIERTA",
          items: {
            create: items.map((item) => {
              const product = productMap.get(item.productId)!;
              const unitPrice = Number(product.price);
              const mods = item.modifiers || [];
              const modifiersTotal = mods.reduce((s, m) => s + m.priceDelta, 0);
              const finalPrice = unitPrice + modifiersTotal;

              return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: product.price,
                modifiersTotal,
                finalPrice,
                notes: item.notes || null,
                status: "PENDIENTE" as const,
                modifiers: mods.length > 0 ? {
                  create: mods.map((m) => ({
                    modifierOptionId: m.modifierOptionId || null,
                    name: m.name,
                    priceDelta: m.priceDelta,
                  })),
                } : undefined,
              };
            }),
          },
        },
        include: {
          items: {
            include: {
              product: true,
              modifiers: true,
            },
          },
          waiter: { select: { name: true } },
          table: true,
        },
      });

      await prisma.table.update({
        where: { id: tableId },
        data: { status: "EN_PREPARACION" },
      });

      await auditLog(request, "CREAR_ORDEN", "orden", order.id, { tableId, items: items.length });

      return reply.status(201).send(order);
    }
  );

  // Create empty order for open-items-only
  app.post<{ Body: { tableId: string; waiterId: string; covers?: number } }>(
    "/api/orders/open-only",
    async (request, reply) => {
      const { tableId, waiterId, covers } = request.body;
      if (!tableId || !waiterId) return reply.status(400).send({ error: "tableId y waiterId requeridos" });

      const order = await prisma.order.create({
        data: { tableId, waiterId, covers: covers || 1, status: "ABIERTA" },
      });

      await prisma.table.update({
        where: { id: tableId },
        data: { status: "EN_PREPARACION" },
      });

      await auditLog(request, "CREAR_ORDEN_ABIERTA", "orden", order.id, { tableId });
      return reply.status(201).send(order);
    }
  );

  app.get("/api/orders", async (request, reply) => {
    const { status, tableId } = request.query as {
      status?: string;
      tableId?: string;
    };

    if (status && !ORDER_STATUSES.includes(status as OrderStatusFilter)) {
      return reply.status(400).send({ error: "Estado de orden inválido" });
    }

    return prisma.order.findMany({
      where: {
        ...(status && { status: status as OrderStatusFilter }),
        ...(tableId && { tableId }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: {
            product: true,
            modifiers: true,
          },
        },
        waiter: { select: { name: true } },
        table: true,
        invoices: { select: { id: true, haciendaStatus: true } },
      },
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/orders/:id",
    async (request, reply) => {
      const order = await prisma.order.findUnique({
        where: { id: request.params.id },
        include: {
          items: {
            include: {
              product: true,
              modifiers: true,
            },
          },
          waiter: { select: { name: true } },
          table: true,
        },
      });

      if (!order) return reply.status(404).send({ error: "Orden no encontrada" });
      return order;
    }
  );

  app.post<{ Params: { id: string }; Body: z.infer<typeof addItemsSchema> }>(
    "/api/orders/:id/items",
    async (request, reply) => {
      const parsed = addItemsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const products = await prisma.product.findMany({
        where: { id: { in: parsed.data.items.map((i) => i.productId) } },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      // Reject stale/unknown products (e.g. cached catalog after admin removed one)
      const missing = parsed.data.items.filter((i) => !productMap.has(i.productId));
      if (missing.length > 0) {
        return reply.status(400).send({
          error: "Uno o más productos ya no están disponibles. Actualice el menú.",
        });
      }

      const items = await Promise.all(
        parsed.data.items.map((item) => {
          const product = productMap.get(item.productId)!;
          const mods = item.modifiers || [];
          const modifiersTotal = mods.reduce((s, m) => s + m.priceDelta, 0);
          const finalPrice = Number(product.price) + modifiersTotal;

          return prisma.orderItem.create({
            data: {
              orderId: request.params.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: product.price,
              modifiersTotal,
              finalPrice,
              notes: item.notes || null,
              status: "PENDIENTE",
              modifiers: mods.length > 0 ? {
                create: mods.map((m) => ({
                  modifierOptionId: m.modifierOptionId || null,
                  name: m.name,
                  priceDelta: m.priceDelta,
                })),
              } : undefined,
            },
            include: { product: true, modifiers: true },
          });
        })
      );

      await auditLog(request, "AGREGAR_ITEMS_ORDEN", "orden", request.params.id, { items: parsed.data.items.length });

      return reply.status(201).send(items);
    }
  );

  // Open item (producto abierto)
  app.post<{ Params: { id: string }; Body: z.infer<typeof openItemSchema> }>(
    "/api/orders/:id/open-item",
    async (request, reply) => {
      const parsed = openItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const role = request.user?.role;
      const allowedOpenItemRoles = ["ADMINISTRADOR", "CAJERO", "BARRA"];
      if (!role || !allowedOpenItemRoles.includes(role)) {
        return reply.status(403).send({
          error: "Este rol no puede crear producto abierto sin aprobación",
        });
      }

      const order = await prisma.order.findUnique({ where: { id: request.params.id } });
      if (!order || order.status !== "ABIERTA") {
        return reply.status(400).send({ error: "Orden no encontrada o cerrada" });
      }

      const { name, price, destination, quantity, notes, createdBy } = parsed.data;

      const item = await prisma.orderItem.create({
        data: {
          orderId: request.params.id,
          productId: null,
          quantity,
          unitPrice: price,
          modifiersTotal: 0,
          finalPrice: price,
          notes: notes || null,
          status: "PENDIENTE",
          isOpenItem: true,
          customName: name,
          destination,
          createdBy,
        },
      });

      await auditLog(request, "CREAR_PRODUCTO_ABIERTO", "detalle_orden", item.id, {
        name, price, destination, createdBy,
      });

      return reply.status(201).send(item);
    }
  );

  const VALID_TRANSITIONS: Record<string, string[]> = {
    PENDIENTE: ["PREPARANDO", "LISTO"],
    PREPARANDO: ["LISTO"],
    LISTO: ["ENTREGADO"],
    ENTREGADO: [],
  };

  app.patch<{
    Params: { orderId: string; itemId: string };
    Body: z.infer<typeof updateItemStatusSchema>;
  }>(
    "/api/orders/:orderId/items/:itemId/status",
    async (request, reply) => {
      const parsed = updateItemStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const current = await prisma.orderItem.findUnique({
        where: { id: request.params.itemId },
      });

      if (!current) return reply.status(404).send({ error: "Item no encontrado" });

      const allowed = VALID_TRANSITIONS[current.status] || [];
      if (!allowed.includes(parsed.data.status)) {
        return reply.status(400).send({
          error: `No se puede cambiar de ${current.status} a ${parsed.data.status}`,
        });
      }

      const item = await prisma.orderItem.update({
        where: { id: request.params.itemId },
        data: { status: parsed.data.status },
        include: { product: true, modifiers: true },
      });

      await auditLog(request, "CAMBIAR_ESTADO_ITEM", "detalle_orden", request.params.itemId, { status: parsed.data.status });

      return item;
    }
  );

  // Batch: mark all LISTO items of an order as ENTREGADO in a single transaction
  app.post<{ Params: { orderId: string } }>(
    "/api/orders/:orderId/items/deliver-all",
    async (request, reply) => {
      const { orderId } = request.params;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true },
      });
      if (!order) {
        return reply.status(404).send({
          ok: false,
          error: "La orden no existe o ya no está disponible.",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const listoItems = await tx.orderItem.findMany({
          where: { orderId, status: "LISTO" },
          select: { id: true },
        });

        if (listoItems.length === 0) {
          return { deliveredCount: 0 };
        }

        await tx.orderItem.updateMany({
          where: { orderId, status: "LISTO" },
          data: { status: "ENTREGADO" },
        });

        return { deliveredCount: listoItems.length };
      });

      await auditLog(request, "ENTREGAR_TODO", "orden", orderId, {
        deliveredCount: result.deliveredCount,
      });

      return {
        ok: true,
        orderId,
        deliveredCount: result.deliveredCount,
        message:
          result.deliveredCount > 0
            ? `${result.deliveredCount} productos fueron marcados como entregados.`
            : "No hay productos listos para entregar.",
      };
    }
  );

  app.get("/api/users", async () => {
    return prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, roleId: true, role: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
  });
}
