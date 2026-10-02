import type { Logger } from "pino";
import type { Env } from "./config/env.js";
import type { FieldCipher } from "./lib/field-crypto.js";
import type { Kv } from "./lib/kv.js";
import type { Mailer } from "./lib/mailer.js";
import type { BreachChecker } from "./lib/password.js";
import type { TokenService } from "./lib/tokens.js";
import type { GoogleClient } from "./services/google.service.js";

export interface AppDeps {
  env: Env;
  logger: Logger;
  kv: Kv;
  tokens: TokenService;
  cipher: FieldCipher;
  mailer: Mailer;
  breachChecker: BreachChecker;
  google: GoogleClient | null;
  dbReady: () => boolean;
  now: () => number;
}

export interface RequestMeta {
  requestId: string;
  ip: string;
  userAgent: string;
}
