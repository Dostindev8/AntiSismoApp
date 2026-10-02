export const ROLES = ["user", "family_member", "org_admin", "platform_admin"] as const;
export type Role = (typeof ROLES)[number];

export const LOCALES = ["es-DO", "en", "fr", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
