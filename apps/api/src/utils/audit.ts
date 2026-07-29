import { FastifyRequest } from "fastify";
import { prisma, Prisma } from "@kitchen/database";

export async function auditLog(
  request: FastifyRequest,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  if (!request.user?.id) return;

  try {
    await prisma.auditLog.create({
      data: {
        userId: request.user.id,
        action,
        entity,
        entityId,
        details: (details || {}) as Prisma.InputJsonValue,
        ip: request.ip,
      },
    });
  } catch (error) {
    request.log.warn({ error }, "No se pudo registrar bitácora");
  }
}
