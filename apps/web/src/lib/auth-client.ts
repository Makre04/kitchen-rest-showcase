export const API_URL = "";

export type StaffRole = "ADMINISTRADOR" | "CAJERO" | "MESERO" | "COCINA" | "BARRA";

export interface StaffUser {
  id: string;
  name: string;
  role: StaffRole;
  branchId: string;
}

export interface StaffSession {
  token: string;
  user: StaffUser;
}

const SESSION_KEY = "kitchen_staff_session";

export function getSession(): StaffSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(session: StaffSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function logout() {
  window.localStorage.removeItem(SESSION_KEY);
  window.location.href = "/login";
}

// Reads the JWT `exp` claim (ms epoch) without verifying the signature — client-side display only.
export function getTokenExpiry(): number | null {
  const session = getSession();
  if (!session?.token) return null;
  try {
    const payloadB64 = session.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(payloadB64));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function authFetch(path: string, init: RequestInit = {}) {
  const session = getSession();
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_KEY);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  return res;
}
