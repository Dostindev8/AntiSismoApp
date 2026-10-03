const paths = {
  wave: "M2 12h4l2-6 4 12 3-9 2 3h5",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  shield: "M12 3 4 6v6c0 4.4 3.4 8.4 8 9 4.6-.6 8-4.6 8-9V6l-8-3Zm-3.5 9 2.5 2.5 4.5-4.5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z",
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6m1-9a3 3 0 1 0 0-6m2 15c0-2.6-1.3-4.8-3.3-5.8",
  community: "M12 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 21v-5a4 4 0 0 1 8 0v5M2 19v-3a3 3 0 0 1 4-2.8M22 19v-3a3 3 0 0 0-4-2.8",
  handshake: "m11 17 2 2a1.4 1.4 0 0 0 2-2l-3-3m-1 3-2-2m4-6-2.5-2.5a2 2 0 0 0-2.8 0L3 12m8-5 2-2a2 2 0 0 1 2.8 0L21 11l-4 4-3-3",
  phone: "M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 12l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9h.01",
  alert: "M12 3 2 20h20L12 3Zm0 6v5m0 3h.01",
  lock: "M6 11h12v10H6V11Zm2 0V8a4 4 0 0 1 8 0v3m-4 4v2",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  check: "M20 6 9 17l-5-5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9c0-4.4 3.6-8 8-8s8 3.6 8 8",
  devices: "M3 5h14v10H3V5Zm4 14h6m-3-4v4m9-11h2v11h-5",
  mail: "M3 6h18v12H3V6Zm0 0 9 7 9-7",
} as const;

export type IconName = keyof typeof paths;

/** Iconos decorativos: siempre acompañan a un texto visible, por eso van con aria-hidden. */
export function Icon({ name, className = "size-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={paths[name]} />
    </svg>
  );
}
