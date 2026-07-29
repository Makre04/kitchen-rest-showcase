import { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

export type StaffRole = "ADMINISTRADOR" | "CAJERO" | "MESERO" | "COCINA" | "BARRA";

export interface AuthUser {
  id: string;
  name: string;
  role: StaffRole;
  branchId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production. Refusing to start API.");
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

export function signStaffToken(user: AuthUser): string {
  return jwt.sign({ ...user }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    await reply.status(401).send({ error: "No autenticado" });
    return;
  }

  try {
    request.user = jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    await reply.status(401).send({ error: "Sesión inválida o expirada" });
  }
}

export function requireRoles(...roles: StaffRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    if (!request.user || !roles.includes(request.user.role)) {
      await reply.status(403).send({ error: "No tiene permisos para esta acción" });
    }
  };
}
