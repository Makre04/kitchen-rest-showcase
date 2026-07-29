"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, type StaffRole } from "./auth-client";

/**
 * Guard de rol para páginas cliente.
 * - Si no hay sesión: redirige a /login.
 * - Si el rol no está permitido: redirige a /.
 * Devuelve "loading" | "authorized" | "unauthorized".
 * Las páginas deben mostrar un spinner mientras sea "loading".
 */
export type AuthState = "loading" | "authorized" | "unauthorized";

export function useRoleGuard(allowed: StaffRole[]): AuthState {
  const router = useRouter();
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    const session = getSession();
    if (!session) {
      setState("unauthorized");
      router.replace("/login");
      return;
    }
    if (!allowed.includes(session.user.role)) {
      setState("unauthorized");
      router.replace("/");
      return;
    }
    setState("authorized");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return state;
}
