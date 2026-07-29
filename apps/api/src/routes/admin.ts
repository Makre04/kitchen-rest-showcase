import { FastifyInstance } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { z } from "zod";
import { hash } from "bcryptjs";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { auditLog } from "../utils/audit.js";

// ── Schemas ─────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().min(2),
  pin: z.string().min(4).max(6),
  email: z.string().email().optional(),
  roleName: z.enum(["ADMINISTRADOR", "CAJERO", "MESERO", "COCINA", "BARRA"]),
  branchId: z.string().min(1),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  pin: z.string().min(4).max(6).optional(),
  email: z.string().email().nullable().optional(),
  roleName: z.enum(["ADMINISTRADOR", "CAJERO", "MESERO", "COCINA", "BARRA"]).optional(),
  active: z.boolean().optional(),
});

const cashSessionQuerySchema = z.object({
  userId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const auditQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const arqueoSchema = z.object({
  sessionId: z.string().min(1),
  countedAmount: z.number().min(0),
  notes: z.string().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireRoles("ADMINISTRADOR"));

  // ══════════════════════════════════════════════════════════
  // EMPLEADOS
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/empleados", async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        role: { select: { name: true } },
        branch: { select: { name: true } },
        _count: {
          select: {
            orders: true,
            cashSessions: true,
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      active: u.active,
      role: u.role.name,
      branch: u.branch.name,
      branchId: u.branchId,
      pinPlain: u.pinPlain,
      ordersCount: u._count.orders,
      cashSessionsCount: u._count.cashSessions,
      createdAt: u.createdAt,
    }));
  });

  app.get<{ Params: { id: string } }>("/api/admin/empleados/:id", async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        role: { select: { name: true } },
        branch: { select: { name: true } },
        orders: {
          where: { status: "CERRADA" },
          orderBy: { paidAt: "desc" },
          take: 10,
          select: { id: true, total: true, paidAt: true, paymentMethod: true },
        },
        cashSessions: {
          orderBy: { openedAt: "desc" },
          take: 5,
          select: {
            id: true,
            openingAmount: true,
            closingAmount: true,
            difference: true,
            openedAt: true,
            closedAt: true,
          },
        },
        _count: { select: { orders: true, cashSessions: true } },
      },
    });

    if (!user) return reply.status(404).send({ error: "Usuario no encontrado" });

    const totalSales = await prisma.order.aggregate({
      where: { waiterId: user.id, status: "CERRADA" },
      _sum: { total: true },
      _count: true,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      role: user.role.name,
      branch: user.branch.name,
      branchId: user.branchId,
      createdAt: user.createdAt,
      recentOrders: user.orders,
      recentCashSessions: user.cashSessions,
      stats: {
        totalOrders: totalSales._count,
        totalSales: totalSales._sum.total || 0,
      },
    };
  });

  app.post<{ Body: z.infer<typeof createUserSchema> }>("/api/admin/empleados", async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { name, pin, email, roleName, branchId } = parsed.data;

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) return reply.status(400).send({ error: "Rol no encontrado" });

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) return reply.status(400).send({ error: "Sucursal no encontrada" });

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return reply.status(400).send({ error: "Email ya registrado" });
    }

    const hashedPin = await hash(pin, 10);
    const user = await prisma.user.create({
      data: { name, pin: hashedPin, pinPlain: pin, email, roleId: role.id, branchId },
      include: { role: { select: { name: true } }, branch: { select: { name: true } } },
    });

    await auditLog(req, "CREAR_EMPLEADO", "usuario", user.id, { name, role: roleName });
    return reply.status(201).send({
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      role: user.role.name,
      branch: user.branch.name,
    });
  });

  app.patch<{ Params: { id: string }; Body: z.infer<typeof updateUserSchema> }>(
    "/api/admin/empleados/:id",
    async (req, reply) => {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

      const data: Record<string, unknown> = {};
      if (parsed.data.name) data.name = parsed.data.name;
      if (parsed.data.pin) {
        data.pin = await hash(parsed.data.pin, 10);
        data.pinPlain = parsed.data.pin;
      }
      if (parsed.data.email !== undefined) data.email = parsed.data.email;
      if (parsed.data.active !== undefined) data.active = parsed.data.active;

      if (parsed.data.roleName) {
        const role = await prisma.role.findUnique({ where: { name: parsed.data.roleName } });
        if (!role) return reply.status(400).send({ error: "Rol no encontrado" });
        data.roleId = role.id;
      }

      const user = await prisma.user.update({
        where: { id: req.params.id },
        data,
        include: { role: { select: { name: true } }, branch: { select: { name: true } } },
      });

      await auditLog(req, "EDITAR_EMPLEADO", "usuario", user.id, parsed.data);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        active: user.active,
        role: user.role.name,
        branch: user.branch.name,
      };
    }
  );

  // ══════════════════════════════════════════════════════════
  // ROLES
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/roles", async () => {
    const roles = await prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    });
    return roles.map((r) => ({ id: r.id, name: r.name, usersCount: r._count.users }));
  });

  // ══════════════════════════════════════════════════════════
  // SUCURSALES
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/sucursales", async () => {
    return prisma.branch.findMany({ orderBy: { name: "asc" } });
  });

  // ══════════════════════════════════════════════════════════
  // TURNOS / SESIONES DE CAJA
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof cashSessionQuerySchema> }>(
    "/api/admin/turnos",
    async (req) => {
      const q = cashSessionQuerySchema.parse(req.query);
      const where: Record<string, unknown> = {};
      if (q.userId) where.userId = q.userId;
      if (q.from || q.to) {
        where.openedAt = {};
        if (q.from) (where.openedAt as Record<string, unknown>).gte = new Date(q.from);
        if (q.to) (where.openedAt as Record<string, unknown>).lte = new Date(q.to);
      }

      const [sessions, total] = await Promise.all([
        prisma.cashSession.findMany({
          where,
          orderBy: { openedAt: "desc" },
          take: q.limit,
          skip: q.offset,
          include: {
            user: { select: { id: true, name: true } },
            movements: {
              select: { type: true, amount: true, paymentMethod: true, createdAt: true, description: true },
              orderBy: { createdAt: "asc" },
            },
          },
        }),
        prisma.cashSession.count({ where }),
      ]);

      return { data: sessions, total, limit: q.limit, offset: q.offset };
    }
  );

  app.get<{ Params: { id: string } }>("/api/admin/turnos/:id", async (req, reply) => {
    const session = await prisma.cashSession.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true } },
        movements: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!session) return reply.status(404).send({ error: "Sesión no encontrada" });
    return session;
  });

  // ══════════════════════════════════════════════════════════
  // ARQUEO DE CAJA
  // ══════════════════════════════════════════════════════════

  app.post<{ Body: z.infer<typeof arqueoSchema> }>("/api/admin/arqueo", async (req, reply) => {
    const parsed = arqueoSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "Datos inválidos" });

    const session = await prisma.cashSession.findUnique({
      where: { id: parsed.data.sessionId },
      include: { movements: true },
    });

    if (!session) return reply.status(404).send({ error: "Sesión no encontrada" });

    const salesTotal = session.movements
      .filter((m) => m.type === "VENTA")
      .reduce((sum, m) => sum + Number(m.amount), 0);
    const entriesTotal = session.movements
      .filter((m) => m.type === "ENTRADA")
      .reduce((sum, m) => sum + Number(m.amount), 0);
    const exitsTotal = session.movements
      .filter((m) => m.type === "SALIDA")
      .reduce((sum, m) => sum + Number(m.amount), 0);
    const cancellationsTotal = session.movements
      .filter((m) => m.type === "CANCELACION")
      .reduce((sum, m) => sum + Number(m.amount), 0);

    const expectedAmount = Number(session.openingAmount) + salesTotal + entriesTotal - exitsTotal - cancellationsTotal;
    const difference = parsed.data.countedAmount - expectedAmount;

    const updated = await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        closingAmount: parsed.data.countedAmount,
        expectedAmount,
        difference,
        closedAt: new Date(),
        notes: parsed.data.notes,
      },
    });

    await auditLog(req, "ARQUEO_CAJA", "sesion_caja", session.id, {
      counted: parsed.data.countedAmount,
      expected: expectedAmount,
      difference,
    });

    return {
      ...updated,
      breakdown: { sales: salesTotal, entries: entriesTotal, exits: exitsTotal, cancellations: cancellationsTotal },
    };
  });

  // ══════════════════════════════════════════════════════════
  // CONTROL DE CAJA POR USUARIO
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/caja-usuarios", async () => {
    const cashUsers = await prisma.user.findMany({
      where: {
        role: { name: { in: ["CAJERO", "ADMINISTRADOR"] } },
        active: true,
      },
      select: {
        id: true,
        name: true,
        role: { select: { name: true } },
        cashSessions: {
          orderBy: { openedAt: "desc" },
          take: 1,
          select: {
            id: true,
            openingAmount: true,
            closingAmount: true,
            difference: true,
            openedAt: true,
            closedAt: true,
          },
        },
        _count: { select: { cashSessions: true } },
      },
    });

    const results = [];
    for (const u of cashUsers) {
      const totals = await prisma.cashSession.aggregate({
        where: { userId: u.id },
        _sum: { difference: true },
        _count: true,
      });
      const sessionWithDiff = await prisma.cashSession.count({
        where: { userId: u.id, difference: { not: null }, NOT: { difference: 0 } },
      });

      results.push({
        id: u.id,
        name: u.name,
        role: u.role.name,
        lastSession: u.cashSessions[0] || null,
        totalSessions: totals._count,
        totalDifference: totals._sum.difference || 0,
        sessionsWithDifference: sessionWithDiff,
      });
    }

    return results;
  });

  // ══════════════════════════════════════════════════════════
  // BITÁCORA
  // ══════════════════════════════════════════════════════════

  app.get<{ Querystring: z.infer<typeof auditQuerySchema> }>("/api/admin/bitacora", async (req) => {
    const q = auditQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = { contains: q.action, mode: "insensitive" };
    if (q.entity) where.entity = { contains: q.entity, mode: "insensitive" };
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Record<string, unknown>).gte = new Date(q.from);
      if (q.to) (where.createdAt as Record<string, unknown>).lte = new Date(q.to);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: { user: { select: { name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data: logs, total, limit: q.limit, offset: q.offset };
  });

  // ══════════════════════════════════════════════════════════
  // CONFIGURACIÓN
  // ══════════════════════════════════════════════════════════

  app.get("/api/admin/config", async () => {
    return prisma.config.findMany({ orderBy: { key: "asc" } });
  });

  app.put<{ Body: { key: string; value: string; description?: string } }>(
    "/api/admin/config",
    async (req, reply) => {
      const { key, value, description } = req.body;
      if (!key || value === undefined) return reply.status(400).send({ error: "key y value son requeridos" });

      const config = await prisma.config.upsert({
        where: { key },
        update: { value, description },
        create: { key, value, description },
      });

      await auditLog(req, "CAMBIAR_CONFIG", "configuracion", config.id, { key, value });
      return config;
    }
  );
}
