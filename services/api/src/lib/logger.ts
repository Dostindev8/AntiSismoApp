import { pino, type Logger } from "pino";

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  "*.password",
  "*.newPassword",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.mfaToken",
  "*.code",
  "*.secret",
  "*.email",
  "*.phone",
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "antisismo-api" },
    timestamp: pino.stdTimeFunctions.epochTime,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  });
}
