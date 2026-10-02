export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  validation: (details?: unknown) => new AppError(400, "VALIDATION_ERROR", "Invalid request", details),
  weakPassword: (details?: unknown) => new AppError(400, "WEAK_PASSWORD", "Password does not meet the policy", details),
  breachedPassword: () => new AppError(400, "BREACHED_PASSWORD", "Password appears in a known data breach"),
  invalidCredentials: () => new AppError(401, "INVALID_CREDENTIALS", "Invalid credentials"),
  unauthenticated: () => new AppError(401, "UNAUTHENTICATED", "Authentication required"),
  invalidToken: () => new AppError(401, "INVALID_TOKEN", "Invalid or expired token"),
  invalidMfa: () => new AppError(401, "INVALID_MFA_CODE", "Invalid verification code"),
  emailNotVerified: () => new AppError(403, "EMAIL_NOT_VERIFIED", "Email address not verified"),
  forbidden: () => new AppError(403, "FORBIDDEN", "Not allowed"),
  csrf: () => new AppError(403, "CSRF_REJECTED", "Request rejected"),
  notFound: () => new AppError(404, "NOT_FOUND", "Resource not found"),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  tooMany: () => new AppError(429, "RATE_LIMITED", "Too many requests"),
  unavailable: (code: string) => new AppError(503, code, "Service temporarily unavailable"),
};
