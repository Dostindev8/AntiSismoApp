"use client";

import type { AuthPolicy } from "@antisismo/proto/account";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { AccountClient } from "./api/client";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Estado de conexión del navegador; en el servidor se asume en línea. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export type PolicyState = { status: "loading" } | { status: "ready"; policy: AuthPolicy } | { status: "error"; error: unknown };

/** Política pública del API (versión de términos, límites de contraseña): nada de esto se fija en el cliente. */
export function usePolicy(client: AccountClient): PolicyState {
  const [state, setState] = useState<PolicyState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    client.policy().then(
      (policy) => alive && setState({ status: "ready", policy }),
      (error: unknown) => alive && setState({ status: "error", error }),
    );
    return () => {
      alive = false;
    };
  }, [client]);
  return state;
}

/** Lee el fragmento `#...` una vez montado (nunca viaja al servidor). */
export function useHash(): string | null {
  return useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => null,
  );
}

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

const fragments = new Map<string, string>();

function capture(path: string, hash: string): void {
  fragments.set(path, hash);
  // Los tokens de un solo uso salen de la barra de direcciones (historial, capturas, extensiones).
  if (hash) window.history.replaceState(window.history.state, "", path + window.location.search);
}

function readFragmentOnce(): string {
  const path = window.location.pathname;
  if (!fragments.has(path)) capture(path, window.location.hash);
  return fragments.get(path) ?? "";
}

function subscribeFragment(cb: () => void) {
  // Abrir otro enlace a la misma ruta solo cambia el fragmento (sin recarga): se captura el nuevo.
  const onHash = () => {
    if (window.location.hash) capture(window.location.pathname, window.location.hash);
    cb();
  };
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}

/** Fragmento `#...` capturado por ruta y retirado de la URL; `null` durante el render del servidor. */
export function useFragmentOnce(): string | null {
  return useSyncExternalStore(subscribeFragment, readFragmentOnce, () => null);
}