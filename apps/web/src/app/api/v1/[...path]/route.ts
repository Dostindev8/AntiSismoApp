import { randomUUID } from "node:crypto";

/** Solo responde cuando API_INTERNAL_ORIGIN no está configurado (si lo está, la reescritura gana). */
function unavailable(): Response {
  return Response.json(
    { code: "API_NOT_CONFIGURED", message: "Account service is not configured for this deployment", requestId: randomUUID() },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
  );
}

export const GET = unavailable;
export const POST = unavailable;
export const PATCH = unavailable;
export const DELETE = unavailable;
