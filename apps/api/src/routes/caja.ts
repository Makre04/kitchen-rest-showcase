import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen/database";
import { z } from "zod";
import { Prisma } from "@kitchen/database";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { IVA_RATE } from "../constants.js";
import { requireRoles } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";
import { emitWithFacturacionProvider } from "../services/facturacion-provider.js";
import {
  generateClaveNumerica,
  generateConsecutivo,
  generateCodigoSeguridad,
  generateInvoiceXml,
  mapPaymentMethod,
  sendToHacienda,
  type HaciendaConfig,
  type InvoiceLine,
} from "../services/hacienda.js";

const openSessionSchema = z.object({
  userId: z.string().min(1),
  openingAmount: z.number().min(0),
});

const closeSessionSchema = z.object({
  closingAmount: z.number().min(0),
  notes: z.string().optional(),
});

const cashMovementSchema = z.object({
  type: z.enum(["ENTRADA", "SALIDA"]),
  amount: z.number().positive(),
  description: z.string().min(1),
  userId: z.string().min(1),
});

const closeOrderSchema = z.object({
  paymentMethod: z.enum(["EFECTIVO", "TARJETA", "SINPE", "MIXTO"]),
  cashierId: z.string().min(1),
  invoiceType: z.enum(["TIQUETE", "FACTURA"]).optional(),
  customerName: z.string().min(1).optional(),
  customerIdType: z.enum(["01", "02", "03", "04"]).optional(),
  customerIdNumber: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
});

const paymentDetailSchema = z.object({
  method: z.enum(["EFECTIVO", "TARJETA", "SINPE"]),
  amount: z.number().positive(),
  reference: z.string().optional(),
});

const payOrderSchema = z.object({
  cashierId: z.string().min(1),
  details: z.array(paymentDetailSchema).min(1),
  invoiceType: z.enum(["TIQUETE", "FACTURA"]).optional(),
  customerName: z.string().min(1).optional(),
  customerIdType: z.enum(["01", "02", "03", "04"]).optional(),
  customerIdNumber: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
});

// Tolerancia de redondeo en colones (2 decimales)
const PAY_EPSILON = 0.01;

export async function cajaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRoles("CAJERO", "ADMINISTRADOR"));
  app.get("/api/caja/session", async (request, reply) => {
    const session = await prisma.cashSession.findFirst({
      where: { closedAt: null },
      include: {
        user: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { user: { select: { name: true } } },
        },
      },
    });

    if (!session) return reply.status(404).send({ error: "No hay caja abierta" });
    return session;
  });

  app.post<{ Body: z.infer<typeof openSessionSchema> }>(
    "/api/caja/open",
    async (request, reply) => {
      const parsed = openSessionSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const session = await prisma.$transaction(async (tx) => {
        const existing = await tx.cashSession.findFirst({ where: { closedAt: null } });
        if (existing) throw new Error("ALREADY_OPEN");

        const created = await tx.cashSession.create({
          data: {
            userId: parsed.data.userId,
            openingAmount: parsed.data.openingAmount,
          },
          include: { user: { select: { id: true, name: true } } },
        });

        await tx.cashMovement.create({
          data: {
            sessionId: created.id,
            type: "APERTURA",
            amount: parsed.data.openingAmount,
            userId: parsed.data.userId,
            description: "Apertura de caja",
          },
        });

        return created;
      }).catch((err) => {
        if (err.message === "ALREADY_OPEN") return null;
        throw err;
      });

      if (!session) return reply.status(409).send({ error: "Ya hay una caja abierta" });

      await auditLog(request, "ABRIR_CAJA", "sesion_caja", session.id, { openingAmount: parsed.data.openingAmount });

      return reply.status(201).send(session);
    }
  );

  app.post<{ Params: { id: string }; Body: z.infer<typeof closeSessionSchema> }>(
    "/api/caja/session/:id/close",
    async (request, reply) => {
      const parsed = closeSessionSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const session = await prisma.cashSession.findUnique({
        where: { id: request.params.id },
        include: { movements: true },
      });

      if (!session) return reply.status(404).send({ error: "Sesión no encontrada" });
      if (session.closedAt) return reply.status(409).send({ error: "La caja ya está cerrada" });

      const expectedAmount = session.movements.reduce((sum, m) => {
        if (m.type === "APERTURA" || m.type === "ENTRADA") return sum.add(m.amount);
        if (m.type === "VENTA" && m.paymentMethod === "EFECTIVO") return sum.add(m.amount);
        if (m.type === "SALIDA") return sum.sub(m.amount);
        return sum;
      }, new Decimal(0));

      const closingAmount = new Decimal(parsed.data.closingAmount);
      const difference = closingAmount.sub(expectedAmount);

      const updated = await prisma.cashSession.update({
        where: { id: request.params.id },
        data: {
          closingAmount: parsed.data.closingAmount,
          expectedAmount,
          difference,
          closedAt: new Date(),
          notes: parsed.data.notes,
        },
        include: {
          user: { select: { id: true, name: true } },
          movements: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { name: true } } },
          },
        },
      });

      await prisma.cashMovement.create({
        data: {
          sessionId: session.id,
          type: "CIERRE",
          amount: parsed.data.closingAmount,
          userId: session.userId,
          description: "Cierre de caja",
        },
      });

      await auditLog(request, "CERRAR_CAJA", "sesion_caja", session.id, { closingAmount: parsed.data.closingAmount, difference: difference.toFixed(2) });

      return updated;
    }
  );

  app.post<{ Body: z.infer<typeof cashMovementSchema> }>(
    "/api/caja/movement",
    async (request, reply) => {
      const parsed = cashMovementSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const session = await prisma.cashSession.findFirst({ where: { closedAt: null } });
      if (!session) return reply.status(409).send({ error: "No hay caja abierta" });

      const movement = await prisma.cashMovement.create({
        data: {
          sessionId: session.id,
          type: parsed.data.type as any,
          amount: parsed.data.amount,
          description: parsed.data.description,
          userId: parsed.data.userId,
        },
        include: { user: { select: { name: true } } },
      });

      await auditLog(request, "MOVIMIENTO_CAJA", "movimiento_caja", movement.id, { type: parsed.data.type, amount: parsed.data.amount });

      return reply.status(201).send(movement);
    }
  );

  app.get("/api/caja/pending", async () => {
    const tables = await prisma.table.findMany({
      where: {
        orders: {
          some: { status: "ABIERTA" },
        },
      },
      select: {
        id: true,
        number: true,
        capacity: true,
        status: true,
        orders: {
          where: { status: "ABIERTA" },
          select: {
            id: true,
            waiter: { select: { name: true } },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                finalPrice: true,
                status: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { number: "asc" },
    });

    return tables.map((table) => {
      const allItems = table.orders.flatMap((o) => o.items);
      const subtotal = allItems.reduce(
        (sum, item) => sum.add(new Decimal(item.finalPrice || item.unitPrice).mul(item.quantity)),
        new Decimal(0)
      );
      const tax = subtotal.mul(IVA_RATE);
      const total = subtotal.add(tax);

      return {
        ...table,
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        total: total.toFixed(2),
        itemCount: allItems.length,
      };
    });
  });

  app.post<{ Params: { tableId: string }; Body: z.infer<typeof closeOrderSchema> }>(
    "/api/caja/tables/:tableId/close",
    async (request, reply) => {
      const parsed = closeOrderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      // Serializable transaction: prevents two simultaneous requests from double-closing the same table
      let txOrders: { id: string }[];
      let txSubtotal: Decimal, txTax: Decimal, txTotal: Decimal;

      try {
        const txResult = await prisma.$transaction(async (tx) => {
          const orders = await tx.order.findMany({
            where: { tableId: request.params.tableId, status: "ABIERTA" },
            include: { items: true },
          });
          if (orders.length === 0) throw Object.assign(new Error("NO_ORDERS"), { _c: 404, _msg: "No hay ordenes abiertas en esta mesa" });

          const session = await tx.cashSession.findFirst({ where: { closedAt: null } });
          if (!session) throw Object.assign(new Error("NO_CAJA"), { _c: 409, _msg: "No hay caja abierta" });

          const allItems = orders.flatMap((o) => o.items);
          const subtotal = allItems.reduce(
            (sum, item) => sum.add(new Decimal(item.finalPrice || item.unitPrice).mul(item.quantity)),
            new Decimal(0)
          );
          const tax = subtotal.mul(IVA_RATE);
          const total = subtotal.add(tax);

          for (const order of orders) {
            const orderItems = order.items;
            const orderSubtotal = orderItems.reduce(
              (sum, item) => sum.add(new Decimal(item.finalPrice || item.unitPrice).mul(item.quantity)),
              new Decimal(0)
            );
            const orderTax = orderSubtotal.mul(IVA_RATE);
            const orderTotal = orderSubtotal.add(orderTax);

            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "CERRADA",
                subtotal: orderSubtotal,
                tax: orderTax,
                total: orderTotal,
                paymentMethod: parsed.data.paymentMethod as any,
                paidAt: new Date(),
              },
            });
          }

          await tx.table.update({
            where: { id: request.params.tableId },
            data: { status: "LIBRE" },
          });

          await tx.cashMovement.create({
            data: {
              sessionId: session.id,
              type: "VENTA",
              amount: total,
              paymentMethod: parsed.data.paymentMethod as any,
              referenceId: request.params.tableId,
              description: `Mesa cobrada`,
              userId: parsed.data.cashierId,
            },
          });

          return { orders, subtotal, tax, total };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        txOrders = txResult.orders;
        txSubtotal = txResult.subtotal;
        txTax = txResult.tax;
        txTotal = txResult.total;
      } catch (err: any) {
        if (err.code === "P2034") {
          return reply.status(409).send({ error: "Mesa en proceso de cobro por otro cajero. Reintente en un momento." });
        }
        if (err._c) return reply.status(err._c).send({ error: err._msg });
        throw err;
      }

      await auditLog(request, "COBRAR_MESA", "mesa", request.params.tableId, { total: txTotal.toFixed(2), paymentMethod: parsed.data.paymentMethod });

      let invoice = null;
      if (parsed.data.invoiceType) {
        try {
          invoice = await createInvoiceForOrders(
            txOrders,
            parsed.data.invoiceType,
            parsed.data.paymentMethod,
            parsed.data.customerName,
            parsed.data.customerIdType,
            parsed.data.customerIdNumber,
            parsed.data.customerEmail
          );
        } catch (err: any) {
          console.error("Invoice creation error:", err.message);
        }
      }

      return {
        subtotal: txSubtotal.toFixed(2),
        tax: txTax.toFixed(2),
        total: txTotal.toFixed(2),
        paymentMethod: parsed.data.paymentMethod,
        ordersCount: txOrders.length,
        invoice: invoice ? { id: invoice.id, sequence: invoice.sequence, type: invoice.type } : null,
      };
    }
  );

  app.post<{ Params: { orderId: string }; Body: z.infer<typeof closeOrderSchema> }>(
    "/api/caja/orders/:orderId/close",
    async (request, reply) => {
      const parsed = closeOrderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      // Serializable transaction: prevents two simultaneous requests from closing the same order
      let txOrder: { id: string; tableId: string; table: { number: number }; items: any[] };
      let txSubtotal: Decimal, txTax: Decimal, txTotal: Decimal, txTableFreed: boolean;

      try {
        const txResult = await prisma.$transaction(async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: request.params.orderId },
            include: { items: true, table: true },
          });
          if (!order) throw Object.assign(new Error("NOT_FOUND"), { _c: 404, _msg: "Orden no encontrada" });
          if (order.status !== "ABIERTA") throw Object.assign(new Error("ALREADY_CLOSED"), { _c: 409, _msg: "La orden ya está cerrada" });

          const session = await tx.cashSession.findFirst({ where: { closedAt: null } });
          if (!session) throw Object.assign(new Error("NO_CAJA"), { _c: 409, _msg: "No hay caja abierta" });

          const subtotal = order.items.reduce(
            (sum, item) => sum.add(new Decimal(item.finalPrice || item.unitPrice).mul(item.quantity)),
            new Decimal(0)
          );
          const tax = subtotal.mul(IVA_RATE);
          const total = subtotal.add(tax);

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "CERRADA",
              subtotal,
              tax,
              total,
              paymentMethod: parsed.data.paymentMethod as any,
              paidAt: new Date(),
            },
          });

          const remainingOpen = await tx.order.count({
            where: { tableId: order.tableId, status: "ABIERTA" },
          });

          await tx.table.update({
            where: { id: order.tableId },
            data: { status: remainingOpen === 0 ? "LIBRE" : "PAGO_PARCIAL" },
          });

          await tx.cashMovement.create({
            data: {
              sessionId: session.id,
              type: "VENTA",
              amount: total,
              paymentMethod: parsed.data.paymentMethod as any,
              referenceId: order.id,
              description: `Cobro orden - Mesa ${order.table.number}`,
              userId: parsed.data.cashierId,
            },
          });

          return { order, subtotal, tax, total, tableFreed: remainingOpen === 0 };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        txOrder = txResult.order;
        txSubtotal = txResult.subtotal;
        txTax = txResult.tax;
        txTotal = txResult.total;
        txTableFreed = txResult.tableFreed;
      } catch (err: any) {
        if (err.code === "P2034") {
          return reply.status(409).send({ error: "Cobro en proceso por otro cajero. Reintente en un momento." });
        }
        if (err._c) return reply.status(err._c).send({ error: err._msg });
        throw err;
      }

      await auditLog(request, "COBRAR_ORDEN", "orden", txOrder.id, { total: txTotal.toFixed(2), paymentMethod: parsed.data.paymentMethod });

      let invoice = null;
      if (parsed.data.invoiceType) {
        try {
          invoice = await createInvoiceForOrders(
            [txOrder],
            parsed.data.invoiceType,
            parsed.data.paymentMethod,
            parsed.data.customerName,
            parsed.data.customerIdType,
            parsed.data.customerIdNumber,
            parsed.data.customerEmail
          );
        } catch (err: any) {
          console.error("Invoice creation error:", err.message);
        }
      }

      return {
        subtotal: txSubtotal.toFixed(2),
        tax: txTax.toFixed(2),
        total: txTotal.toFixed(2),
        paymentMethod: parsed.data.paymentMethod,
        tableFreed: txTableFreed,
        invoice: invoice ? { id: invoice.id, sequence: invoice.sequence, type: invoice.type } : null,
      };
    }
  );

  // Pago mixto / parcial de una orden
  app.post<{ Params: { orderId: string }; Body: z.infer<typeof payOrderSchema> }>(
    "/api/caja/orders/:orderId/pay",
    async (request, reply) => {
      const parsed = payOrderSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      // Serializable transaction: read balance, validate, write Payment — all atomic.
      // Prevents two simultaneous requests from both seeing a positive balance and creating two payments.
      let txPaymentId: string;
      let txOrder: { id: string; tableId: string; table: { number: number }; items: any[] };
      let txSubtotal: Decimal, txTax: Decimal, txTotal: Decimal;
      let txPaymentSum: Decimal, txNewPaidTotal: Decimal, txBalanceAfter: Decimal;
      let txFullyPaid: boolean, txTableFreed: boolean, txPaymentMethodLabel: string;

      try {
        const txResult = await prisma.$transaction(async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: request.params.orderId },
            include: { items: true, table: true },
          });
          if (!order) throw Object.assign(new Error("NOT_FOUND"), { _c: 404, _msg: "Orden no encontrada" });
          if (order.status !== "ABIERTA") throw Object.assign(new Error("ALREADY_CLOSED"), { _c: 409, _msg: "La orden ya está cerrada" });

          const session = await tx.cashSession.findFirst({ where: { closedAt: null } });
          if (!session) throw Object.assign(new Error("NO_CAJA"), { _c: 409, _msg: "No hay caja abierta" });

          const subtotal = order.items.reduce(
            (sum, item) => sum.add(new Decimal(item.finalPrice || item.unitPrice).mul(item.quantity)),
            new Decimal(0)
          );
          const tax = subtotal.mul(IVA_RATE);
          const total = subtotal.add(tax);

          // Read existing payments inside the transaction to get a consistent balance
          const previousPayments = await tx.payment.findMany({ where: { orderId: order.id } });
          const alreadyPaid = previousPayments.reduce((s, p) => s.add(p.paidAmount), new Decimal(0));
          const balanceBefore = total.sub(alreadyPaid);

          if (balanceBefore.lte(0)) {
            throw Object.assign(new Error("ALREADY_PAID"), { _c: 409, _msg: "La orden ya está saldada" });
          }

          const paymentSum = parsed.data.details.reduce((s, d) => s.add(new Decimal(d.amount)), new Decimal(0));

          if (paymentSum.sub(balanceBefore).toNumber() > PAY_EPSILON) {
            throw Object.assign(new Error("EXCEEDS_BALANCE"), {
              _c: 400,
              _msg: `El monto (${paymentSum.toFixed(2)}) excede el saldo pendiente (${balanceBefore.toFixed(2)})`,
            });
          }

          const newPaidTotal = alreadyPaid.add(paymentSum);
          const balanceAfter = total.sub(newPaidTotal);
          const fullyPaid = balanceAfter.toNumber() <= PAY_EPSILON;
          const paymentMethodLabel = parsed.data.details.length > 1 ? "MIXTO" : parsed.data.details[0].method;

          const payment = await tx.payment.create({
            data: {
              tableId: order.tableId,
              orderId: order.id,
              cashierId: parsed.data.cashierId,
              subtotal,
              tax,
              total,
              paidAmount: paymentSum,
              balance: balanceAfter.lt(0) ? new Decimal(0) : balanceAfter,
              status: fullyPaid ? "PAGADO" : "PARCIAL",
              receiptType: fullyPaid && parsed.data.invoiceType ? parsed.data.invoiceType : null,
              details: {
                create: parsed.data.details.map((d) => ({
                  method: d.method as any,
                  amount: d.amount,
                  reference: d.reference || null,
                })),
              },
            },
          });

          for (const d of parsed.data.details) {
            await tx.cashMovement.create({
              data: {
                sessionId: session.id,
                type: "VENTA",
                amount: d.amount,
                paymentMethod: d.method as any,
                referenceId: order.id,
                description: `Abono Mesa ${order.table.number}${fullyPaid ? " (saldado)" : " (parcial)"}`,
                userId: parsed.data.cashierId,
              },
            });
          }

          let tableFreed = false;
          if (fullyPaid) {
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "CERRADA",
                subtotal,
                tax,
                total,
                paymentMethod: paymentMethodLabel as any,
                paidAt: new Date(),
              },
            });

            const remainingOpen = await tx.order.count({
              where: { tableId: order.tableId, status: "ABIERTA" },
            });
            await tx.table.update({
              where: { id: order.tableId },
              data: { status: remainingOpen === 0 ? "LIBRE" : "PAGO_PARCIAL" },
            });
            tableFreed = remainingOpen === 0;
          } else {
            await tx.table.update({
              where: { id: order.tableId },
              data: { status: "PAGO_PARCIAL" },
            });
          }

          return { payment, order, subtotal, tax, total, paymentSum, newPaidTotal, balanceAfter, fullyPaid, tableFreed, paymentMethodLabel };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        txPaymentId = txResult.payment.id;
        txOrder = txResult.order;
        txSubtotal = txResult.subtotal;
        txTax = txResult.tax;
        txTotal = txResult.total;
        txPaymentSum = txResult.paymentSum;
        txNewPaidTotal = txResult.newPaidTotal;
        txBalanceAfter = txResult.balanceAfter;
        txFullyPaid = txResult.fullyPaid;
        txTableFreed = txResult.tableFreed;
        txPaymentMethodLabel = txResult.paymentMethodLabel;
      } catch (err: any) {
        if (err.code === "P2034") {
          return reply.status(409).send({ error: "Cobro en proceso por otro cajero. Reintente en un momento." });
        }
        if (err._c) return reply.status(err._c).send({ error: err._msg });
        throw err;
      }

      // Invoice and audit log run outside the transaction to avoid timeouts from external calls
      let invoice = null;
      if (txFullyPaid) {
        if (parsed.data.invoiceType) {
          try {
            invoice = await createInvoiceForOrders(
              [txOrder],
              parsed.data.invoiceType,
              txPaymentMethodLabel,
              parsed.data.customerName,
              parsed.data.customerIdType,
              parsed.data.customerIdNumber,
              parsed.data.customerEmail
            );
          } catch (err: any) {
            console.error("Invoice creation error:", err.message);
          }
        }
        await auditLog(request, "COBRAR_ORDEN", "orden", txOrder.id, {
          total: txTotal.toFixed(2), paymentMethod: txPaymentMethodLabel, mixto: parsed.data.details.length > 1,
        });
      } else {
        await auditLog(request, "ABONO_PARCIAL", "orden", txOrder.id, {
          abono: txPaymentSum.toFixed(2), saldo: txBalanceAfter.toFixed(2),
        });
      }

      return {
        paymentId: txPaymentId,
        status: txFullyPaid ? "PAGADO" : "PARCIAL",
        total: txTotal.toFixed(2),
        paidNow: txPaymentSum.toFixed(2),
        totalPaid: txNewPaidTotal.toFixed(2),
        balance: (txBalanceAfter.lt(0) ? new Decimal(0) : txBalanceAfter).toFixed(2),
        paymentMethod: txPaymentMethodLabel,
        tableFreed: txTableFreed,
        invoice: invoice ? { id: invoice.id, sequence: invoice.sequence, type: invoice.type } : null,
      };
    }
  );

  app.get("/api/caja/summary", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const closedOrders = await prisma.order.findMany({
      where: {
        status: "CERRADA",
        paidAt: { gte: today },
      },
    });

    const byMethod: Record<string, { count: number; total: Decimal }> = {};
    let totalSales = new Decimal(0);
    let totalTax = new Decimal(0);

    for (const order of closedOrders) {
      const method = order.paymentMethod || "EFECTIVO";
      if (!byMethod[method]) byMethod[method] = { count: 0, total: new Decimal(0) };
      byMethod[method].count++;
      byMethod[method].total = byMethod[method].total.add(order.total);
      totalSales = totalSales.add(order.total);
      totalTax = totalTax.add(order.tax);
    }

    const methodSummary = Object.entries(byMethod).map(([method, data]) => ({
      method,
      count: data.count,
      total: data.total.toFixed(2),
    }));

    return {
      totalOrders: closedOrders.length,
      totalSales: totalSales.toFixed(2),
      totalTax: totalTax.toFixed(2),
      totalSubtotal: totalSales.sub(totalTax).toFixed(2),
      byMethod: methodSummary,
    };
  });
}

async function getHaciendaConfig(): Promise<HaciendaConfig | null> {
  const keys = [
    "HACIENDA_CEDULA", "HACIENDA_NOMBRE", "HACIENDA_NOMBRE_COMERCIAL",
    "HACIENDA_CODIGO_ACTIVIDAD", "HACIENDA_EMAIL", "HACIENDA_TELEFONO",
    "HACIENDA_PROVINCIA", "HACIENDA_CANTON", "HACIENDA_DISTRITO",
    "HACIENDA_DIRECCION", "HACIENDA_USUARIO", "HACIENDA_PASSWORD",
    "HACIENDA_PIN", "HACIENDA_SANDBOX",
  ];
  const configs = await prisma.config.findMany({ where: { key: { in: keys } } });
  const m = new Map(configs.map((c) => [c.key, c.value]));
  if (!m.get("HACIENDA_CEDULA") || !m.get("HACIENDA_USUARIO")) return null;
  return {
    cedula: m.get("HACIENDA_CEDULA")!,
    nombre: m.get("HACIENDA_NOMBRE") || "Kitchen Restaurante",
    nombreComercial: m.get("HACIENDA_NOMBRE_COMERCIAL"),
    codigoActividad: m.get("HACIENDA_CODIGO_ACTIVIDAD") || "561010",
    email: m.get("HACIENDA_EMAIL") || "",
    telefono: m.get("HACIENDA_TELEFONO") || "",
    provincia: m.get("HACIENDA_PROVINCIA") || "1",
    canton: m.get("HACIENDA_CANTON") || "01",
    distrito: m.get("HACIENDA_DISTRITO") || "01",
    direccion: m.get("HACIENDA_DIRECCION") || "Costa Rica",
    usuario: m.get("HACIENDA_USUARIO")!,
    password: m.get("HACIENDA_PASSWORD") || "",
    pin: m.get("HACIENDA_PIN") || "",
    sandbox: m.get("HACIENDA_SANDBOX") === "true",
  };
}

async function getNextSequence(): Promise<number> {
  const config = await prisma.config.findUnique({ where: { key: "INVOICE_CONSECUTIVE" } });
  const next = parseInt(config?.value || "0", 10) + 1;
  await prisma.config.upsert({
    where: { key: "INVOICE_CONSECUTIVE" },
    update: { value: String(next) },
    create: { key: "INVOICE_CONSECUTIVE", value: String(next), description: "Último consecutivo de factura emitida" },
  });
  return next;
}

async function createInvoiceForOrders(
  orders: { id: string }[],
  type: "TIQUETE" | "FACTURA",
  paymentMethod: string,
  customerName?: string,
  customerIdType?: "01" | "02" | "03" | "04",
  customerIdNumber?: string,
  customerEmail?: string,
) {
  if (type === "FACTURA" && (!customerIdNumber || !customerName)) {
    throw new Error("Factura requiere nombre y cédula");
  }

  const ordersWithItems = await prisma.order.findMany({
    where: { id: { in: orders.map((o) => o.id) } },
    include: { items: { include: { product: true, modifiers: true } }, table: true },
  });

  // Guard against double invoice: if one already exists for the primary order, return it
  const mainOrderId = ordersWithItems[0]?.id;
  if (mainOrderId) {
    const existing = await prisma.invoice.findFirst({ where: { orderId: mainOrderId } });
    if (existing) return existing;
  }

  let customerId: string | null = null;
  if (type === "FACTURA" && customerIdNumber && customerName) {
    const existing = await prisma.customer.findFirst({ where: { idDoc: customerIdNumber } });
    if (existing) {
      customerId = existing.id;
      await prisma.customer.update({
        where: { id: existing.id },
        data: { name: customerName, ...(customerEmail && { email: customerEmail }) },
      });
    } else {
      const c = await prisma.customer.create({
        data: { name: customerName, idDoc: customerIdNumber, email: customerEmail || null },
      });
      customerId = c.id;
    }
  }

  const mainOrder = ordersWithItems[0];
  const allItems = ordersWithItems.flatMap((o) => o.items);

  const lines: InvoiceLine[] = allItems.map((item: any) => {
    const price = Number(item.finalPrice || item.unitPrice);
    const sub = price * item.quantity;
    const itemTax = sub * IVA_RATE;
    const desc = item.isOpenItem ? (item.customName || "Producto abierto") : (item.product?.name || "Producto");
    return { quantity: item.quantity, description: desc, unitPrice: price, subtotal: sub, tax: itemTax, total: sub + itemTax };
  });

  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  const total = subtotal + tax;

  const sequence = await getNextSequence();
  const consecutivo = generateConsecutivo(type, sequence);
  const codigoSeguridad = generateCodigoSeguridad();
  const haciendaConfig = await getHaciendaConfig();
  const cedula = haciendaConfig?.cedula || "3101000000";
  const clave = generateClaveNumerica(cedula, consecutivo, "1", codigoSeguridad);

  let haciendaStatus: "PENDIENTE" | "ACEPTADO" | "RECHAZADO" = "PENDIENTE";
  let haciendaError: string | null = null;
  let xmlSent: string | null = null;
  let xmlResponse: string | null = null;
  let pdfUrl: string | null = null;
  let sentAt: Date | null = null;

  const providerResult = await emitWithFacturacionProvider({
    type, orderId: mainOrder.id,
    customer: type === "FACTURA" && customerName
      ? { name: customerName, idType: customerIdType, idNumber: customerIdNumber, email: customerEmail }
      : undefined,
    lines, subtotal, tax, total, paymentMethod,
  });

  if (providerResult) {
    haciendaStatus = providerResult.status;
    haciendaError = providerResult.error || null;
    xmlSent = providerResult.xml || null;
    xmlResponse = providerResult.responseXml || null;
    pdfUrl = providerResult.pdfUrl || null;
    sentAt = new Date();
  } else if (haciendaConfig) {
    xmlSent = generateInvoiceXml(clave, {
      type, sequence, emitterConfig: haciendaConfig,
      receiver: type === "FACTURA" && customerName && customerIdType && customerIdNumber
        ? { name: customerName, idType: customerIdType, idNumber: customerIdNumber, email: customerEmail }
        : undefined,
      lines, subtotal, tax, total,
      paymentMethod: mapPaymentMethod(paymentMethod),
      saleCondition: "01",
    });
    try {
      const result = await sendToHacienda(xmlSent, clave, haciendaConfig);
      sentAt = new Date();
      if (result.status === 201 || result.status === 202) haciendaStatus = "PENDIENTE";
      else haciendaError = `HTTP ${result.status}: ${JSON.stringify(result.body)}`;
    } catch (err: any) {
      haciendaError = err.message || "Error de conexión con Hacienda";
    }
  } else {
    haciendaError = "Credenciales de Hacienda no configuradas (modo local)";
  }

  return prisma.invoice.create({
    data: {
      orderId: mainOrder.id, customerId, type, sequence,
      haciendaKey: clave, haciendaStatus,
      subtotal, tax, total,
      paymentMethod: paymentMethod as "EFECTIVO" | "TARJETA" | "SINPE" | "MIXTO",
      xmlSent, xmlResponse, pdfUrl, haciendaError, sentAt,
    },
  });
}
