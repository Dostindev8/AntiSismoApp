"use client";

import type { PublicUser } from "@antisismo/proto/account";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createAccountClient, type AccountClient, type LockManagerLike } from "@/lib/api/client";

type Status = "loading" | "authenticated" | "anonymous";
interface AuthState {
  status: Status;
  user: PublicUser | null;
  client: AccountClient;
  /** Cierra sesión aquí y avisa a las demás pestañas. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const CHANNEL = "antisismo-auth";
/** Solo un indicador booleano (nunca un token): evita llamar al API en cada visita anónima. */
const HINT_KEY = "antisismo.has-session";

function setHint(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* almacenamiento bloqueado: se degrada a restaurar siempre */
  }
}

function hasHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const channelRef = useRef<BroadcastChannel | null>(null);

  const client = useMemo(
    () =>
      createAccountClient({
        locks: typeof navigator !== "undefined" && "locks" in navigator ? (navigator.locks as unknown as LockManagerLike) : null,
        onSession: (u) => {
          setHint(u !== null);
          setUser(u);
          setStatus(u ? "authenticated" : "anonymous");
        },
      }),
    [],
  );

  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    if (channel) {
      channel.onmessage = (e: MessageEvent<unknown>) => {
        if (e.data === "signed-out") client.forget();
        if (e.data === "signed-in" && !client.authenticated) void client.restore().catch(() => undefined);
      };
    }
    if (hasHint()) void client.restore().catch(() => undefined);
    else client.forget();
    return () => channel?.close();
  }, [client]);

  const previous = useRef<Status>("loading");
  useEffect(() => {
    if (previous.current === "anonymous" && status === "authenticated") channelRef.current?.postMessage("signed-in");
    previous.current = status;
  }, [status]);

  const signOut = useCallback(async () => {
    try {
      await client.logout();
    } finally {
      channelRef.current?.postMessage("signed-out");
    }
  }, [client]);

  const value = useMemo(() => ({ status, user, client, signOut }), [status, user, client, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
