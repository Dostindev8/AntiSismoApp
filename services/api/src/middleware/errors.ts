import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { AppError, errors } from "../lib/errors.js";

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(errors.notFound());

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return errors.validation(err.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })));
  }
  const type = (err as { type?: unknown }).type;
  if (type === "entity.parse.failed") return new AppError(400, "INVALID_JSON", "Malformed JSON body");
  if (type === "entity.too.large") return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  if (type === "encoding.unsupported" || type === "charset.unsupported") return new AppError(415, "UNSUPPORTED_ENCODING", "Unsupported encoding");
  return new AppError(500, "INTERNAL_ERROR", "Unexpected error");
}

/** Formato uniforme { code, message, requestId[, details] }; nunca filtra stack ni mensajes internos. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const appErr = normalize(err);
    const requestId = String(res.locals.requestId ?? "");
    if (appErr.status >= 500) logger.error({ err, requestId }, "unhandled error");
    res.status(appErr.status).json({
      code: appErr.code,
      message: appErr.message,
      requestId,
      ...(appErr.details === undefined ? {} : { details: appErr.details }),
    });
  };
}
