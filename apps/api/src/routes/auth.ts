import { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@kitchen-rest/database";
import { compare } from "bcryptjs";
import { z } from "zod";
import { requireAuth, signStaffToken } from "../middleware/auth.js";

async function logLoginSuccess(
  request: FastifyRequest,
  user: { id: string; name: string; role: string }
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        entity: "usuario",
        entityId: user.id,
        details: { name: user.name, role: user.role, success: true },
        ip: request.ip,
      },
    });
  } catch (error) {
    request.log.warn({ error }, "No se pudo registrar login en bitácora");
  }
}

const pinLoginSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, "El PIN debe tener de 4 a 6 dígitos"),
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: z.infer<typeof pinLoginSchema> }>("/api/auth/pin", async (request, reply) => {
    const parsed = pinLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const users = await prisma.user.findMany({
      where: { active: true },
      include: { role: true, branch: true },
    });

    for (const user of users) {
      const ok = await compare(parsed.data.pin, user.pin);
      if (!ok) continue;

      const authUser = {
        id: user.id,
        name: user.name,
        role: user.role.name,
        branchId: user.branchId,
      } as const;

      const token = signStaffToken(authUser);
      await logLoginSuccess(request, authUser);
      return reply.send({ token, user: authUser });
    }

    request.log.warn({ ip: request.ip }, "Intento de login con PIN inválido");
    return reply.status(401).send({ error: "PIN inválido" });
  });

  app.post<{ Body: z.infer<typeof adminLoginSchema> }>("/api/auth/admin", async (request, reply) => {
    const parsed = adminLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      include: { role: true, branch: true },
    });

    if (!user || !user.passwordHash || !user.active) {
      return reply.status(401).send({ error: "Credenciales inválidas" });
    }

    const ok = await compare(parsed.data.password, user.passwordHash);
    if (!ok) return reply.status(401).send({ error: "Credenciales inválidas" });

    if (user.role.name !== "ADMINISTRADOR") {
      return reply.status(403).send({ error: "Solo administradores pueden usar este acceso" });
    }

    const authUser = {
      id: user.id,
      name: user.name,
      role: user.role.name,
      branchId: user.branchId,
    } as const;

    const token = signStaffToken(authUser);
    await logLoginSuccess(request, authUser);
    return reply.send({ token, user: authUser });
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    return { user: request.user };
  });
}
