import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { z } from "zod";
import { requireRoles } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";
import { emitWithFacturacionProvider } from "../services/facturacion-provider.js";
import { IVA_RATE } from "../constants.js";
import {
  generateClaveNumerica,
  generateConsecutivo,
  generateCodigoSeguridad,
  generateInvoiceXml,
  mapPaymentMethod,
  sendToHacienda,
  checkHaciendaStatus,
  type HaciendaConfig,
  type InvoiceLine,
} from "../services/hacienda.js";

const createInvoiceSchema = z.object({
  orderId: z.string().min(1),
  type: z.enum(["TIQUETE", "FACTURA"]),
  customerId: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  customerIdType: z.enum(["01", "02", "03", "04"]).optional(),
  customerIdNumber: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
});

async function getHaciendaConfig(): Promise<HaciendaConfig | null> {
  const keys = [
    "HACIENDA_CEDULA",
    "HACIENDA_NOMBRE",
    "HACIENDA_NOMBRE_COMERCIAL",
    "HACIENDA_CODIGO_ACTIVIDAD",
    "HACIENDA_EMAIL",
    "HACIENDA_TELEFONO",
    "HACIENDA_PROVINCIA",
    "HACIENDA_CANTON",
    "HACIENDA_DISTRITO",
    "HACIENDA_DIRECCION",
    "HACIENDA_USUARIO",
    "HACIENDA_PASSWORD",
    "HACIENDA_PIN",
    "HACIENDA_SANDBOX",
  ];

  const configs = await prisma.config.findMany({
    where: { key: { in: keys } },
  });

  const configMap = new Map(configs.map((c) => [c.key, c.value]));

  if (!configMap.get("HACIENDA_CEDULA") || !configMap.get("HACIENDA_USUARIO")) {
    return null;
  }

  return {
    cedula: configMap.get("HACIENDA_CEDULA")!,
    nombre: configMap.get("HACIENDA_NOMBRE") || "Kitchen Restaurante",
    nombreComercial: configMap.get("HACIENDA_NOMBRE_COMERCIAL"),
    codigoActividad: configMap.get("HACIENDA_CODIGO_ACTIVIDAD") || "561010",
    email: configMap.get("HACIENDA_EMAIL") || "",
    telefono: configMap.get("HACIENDA_TELEFONO") || "",
    provincia: configMap.get("HACIENDA_PROVINCIA") || "1",
    canton: configMap.get("HACIENDA_CANTON") || "01",
    distrito: configMap.get("HACIENDA_DISTRITO") || "01",
    direccion: configMap.get("HACIENDA_DIRECCION") || "Costa Rica",
    usuario: configMap.get("HACIENDA_USUARIO")!,
    password: configMap.get("HACIENDA_PASSWORD") || "",
    pin: configMap.get("HACIENDA_PIN") || "",
    sandbox: configMap.get("HACIENDA_SANDBOX") === "true",
  };
}

async function getNextSequence(): Promise<number> {
  const config = await prisma.config.findUnique({
    where: { key: "INVOICE_CONSECUTIVE" },
  });

  const current = parseInt(config?.value || "0", 10);
  const next = current + 1;

  await prisma.config.upsert({
    where: { key: "INVOICE_CONSECUTIVE" },
    update: { value: String(next) },
    create: {
      key: "INVOICE_CONSECUTIVE",
      value: String(next),
      description: "Último consecutivo de factura emitida",
    },
  });

  return next;
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRoles("CAJERO", "ADMINISTRADOR"));
  app.get("/api/invoices", async (request) => {
    const { status, type, limit } = request.query as {
      status?: string;
      type?: string;
      limit?: string;
    };

    return prisma.invoice.findMany({
      where: {
        ...(status && { haciendaStatus: status as any }),
        ...(type && { type: type as any }),
      },
      orderBy: { createdAt: "desc" },
      take: parseInt(limit || "50", 10),
      include: {
        order: {
          include: {
            table: true,
            waiter: { select: { name: true } },
          },
        },
        customer: true,
      },
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/invoices/:id",
    async (request, reply) => {
      const invoice = await prisma.invoice.findUnique({
        where: { id: request.params.id },
        include: {
          order: {
            include: {
              table: true,
              waiter: { select: { name: true } },
              items: { include: { product: true } },
            },
          },
          customer: true,
        },
      });

      if (!invoice) return reply.status(404).send({ error: "Factura no encontrada" });
      return invoice;
    }
  );

  app.post<{ Body: z.infer<typeof createInvoiceSchema> }>(
    "/api/invoices",
    async (request, reply) => {
      const parsed = createInvoiceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const { orderId, type, customerName, customerIdType, customerIdNumber, customerEmail } = parsed.data;

      if (type === "FACTURA" && (!customerIdNumber || !customerName)) {
        return reply.status(400).send({
          error: "Factura electrónica requiere nombre y cédula del cliente",
        });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          table: true,
          invoices: true,
        },
      });

      if (!order) return reply.status(404).send({ error: "Orden no encontrada" });
      if (order.status !== "CERRADA") {
        return reply.status(409).send({ error: "La orden debe estar cerrada para facturar" });
      }

      const existingInvoice = order.invoices.find(
        (i) => i.haciendaStatus !== "RECHAZADO"
      );
      if (existingInvoice) {
        return reply.status(409).send({
          error: "Esta orden ya tiene una factura emitida",
          invoiceId: existingInvoice.id,
        });
      }

      let customerId: string | null = null;
      if (type === "FACTURA" && customerIdNumber && customerName) {
        const existing = await prisma.customer.findFirst({
          where: { idDoc: customerIdNumber },
        });

        if (existing) {
          customerId = existing.id;
          await prisma.customer.update({
            where: { id: existing.id },
            data: {
              name: customerName,
              ...(customerEmail && { email: customerEmail }),
            },
          });
        } else {
          const newCustomer = await prisma.customer.create({
            data: {
              name: customerName,
              idDoc: customerIdNumber,
              email: customerEmail || null,
            },
          });
          customerId = newCustomer.id;
        }
      }

      const sequence = await getNextSequence();
      const consecutivo = generateConsecutivo(type, sequence);
      const codigoSeguridad = generateCodigoSeguridad();

      const haciendaConfig = await getHaciendaConfig();
      const cedula = haciendaConfig?.cedula || "3101000000";

      const clave = generateClaveNumerica(cedula, consecutivo, "1", codigoSeguridad);

      const lines: InvoiceLine[] = order.items.map((item) => {
        const unitPrice = Number(item.unitPrice);
        const sub = unitPrice * item.quantity;
        const itemTax = sub * IVA_RATE;
        return {
          quantity: item.quantity,
          description: item.product?.name || item.customName || "Producto",
          unitPrice,
          subtotal: sub,
          tax: itemTax,
          total: sub + itemTax,
        };
      });

      const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
      const tax = lines.reduce((s, l) => s + l.tax, 0);
      const total = subtotal + tax;

      let xmlSent: string | null = null;
      let haciendaStatus: "PENDIENTE" | "ACEPTADO" | "RECHAZADO" = "PENDIENTE";
      let haciendaError: string | null = null;
      let sentAt: Date | null = null;
      let pdfUrl: string | null = null;
      let xmlResponse: string | null = null;

      const providerResult = await emitWithFacturacionProvider({
        type,
        orderId,
        customer:
          type === "FACTURA" && customerName
            ? {
                name: customerName,
                idType: customerIdType,
                idNumber: customerIdNumber,
                email: customerEmail,
              }
            : undefined,
        lines,
        subtotal,
        tax,
        total,
        paymentMethod: order.paymentMethod,
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
          type,
          sequence,
          emitterConfig: haciendaConfig,
          receiver:
            type === "FACTURA" && customerName && customerIdType && customerIdNumber
              ? {
                  name: customerName,
                  idType: customerIdType,
                  idNumber: customerIdNumber,
                  email: customerEmail,
                }
              : undefined,
          lines,
          subtotal,
          tax,
          total,
          paymentMethod: mapPaymentMethod(order.paymentMethod),
          saleCondition: "01",
        });

        try {
          const result = await sendToHacienda(xmlSent, clave, haciendaConfig);
          sentAt = new Date();
          if (result.status === 201 || result.status === 202) {
            haciendaStatus = "PENDIENTE";
          } else {
            haciendaError = `HTTP ${result.status}: ${JSON.stringify(result.body)}`;
          }
        } catch (err: any) {
          haciendaError = err.message || "Error de conexión con Hacienda";
        }
      } else {
        haciendaError = "Credenciales de Hacienda no configuradas (modo local)";
      }

      const invoice = await prisma.invoice.create({
        data: {
          orderId,
          customerId,
          type,
          sequence,
          haciendaKey: clave,
          haciendaStatus,
          subtotal,
          tax,
          total,
          paymentMethod: order.paymentMethod,
          xmlSent,
          xmlResponse,
          pdfUrl,
          haciendaError,
          sentAt,
        },
        include: {
          order: {
            include: {
              table: true,
              waiter: { select: { name: true } },
            },
          },
          customer: true,
        },
      });

      await auditLog(request, "EMITIR_COMPROBANTE", "factura", invoice.id, { type, total, status: haciendaStatus });

      return reply.status(201).send(invoice);
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/invoices/:id/check",
    async (request, reply) => {
      const invoice = await prisma.invoice.findUnique({
        where: { id: request.params.id },
      });

      if (!invoice) return reply.status(404).send({ error: "Factura no encontrada" });
      if (!invoice.haciendaKey) {
        return reply.status(400).send({ error: "Factura sin clave de Hacienda" });
      }
      if (invoice.haciendaStatus !== "PENDIENTE") {
        return reply.send({ status: invoice.haciendaStatus });
      }

      const config = await getHaciendaConfig();
      if (!config) {
        return reply.status(409).send({ error: "Credenciales de Hacienda no configuradas" });
      }

      try {
        const result = await checkHaciendaStatus(invoice.haciendaKey, config);

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            haciendaStatus: result.status as any,
            xmlResponse: result.xml,
            haciendaError: result.error,
          },
        });

        await auditLog(request, "CONSULTAR_HACIENDA", "factura", invoice.id, { status: result.status });
        return { status: result.status, error: result.error };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/invoices/:id/resend",
    async (request, reply) => {
      const invoice = await prisma.invoice.findUnique({
        where: { id: request.params.id },
      });

      if (!invoice) return reply.status(404).send({ error: "Factura no encontrada" });
      if (invoice.haciendaStatus === "ACEPTADO") {
        return reply.status(409).send({ error: "Factura ya fue aceptada" });
      }
      if (!invoice.xmlSent) {
        return reply.status(400).send({ error: "No hay XML para reenviar" });
      }

      const config = await getHaciendaConfig();
      if (!config) {
        return reply.status(409).send({ error: "Credenciales de Hacienda no configuradas" });
      }

      try {
        const result = await sendToHacienda(
          invoice.xmlSent,
          invoice.haciendaKey!,
          config
        );

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            haciendaStatus: "PENDIENTE",
            haciendaError:
              result.status === 201 || result.status === 202
                ? null
                : `HTTP ${result.status}: ${JSON.stringify(result.body)}`,
            sentAt: new Date(),
          },
        });

        await auditLog(request, "REENVIAR_HACIENDA", "factura", invoice.id, { status: result.status });

        return {
          status: result.status,
          message: result.status === 202 || result.status === 201 ? "Reenviado exitosamente" : "Error al reenviar",
        };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get("/api/invoices/config/status", async () => {
    const config = await getHaciendaConfig();
    return {
      configured: config !== null,
      sandbox: config?.sandbox || false,
      cedula: config?.cedula ? `***${config.cedula.slice(-4)}` : null,
      nombre: config?.nombre || null,
    };
  });

  app.get("/api/customers/search", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q || q.length < 2) return [];

    return prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { idDoc: { contains: q } },
        ],
      },
      take: 10,
      orderBy: { name: "asc" },
    });
  });
}
