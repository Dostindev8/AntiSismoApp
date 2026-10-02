import mongoose, { Schema, type Model, type Types } from "mongoose";
import { LOCALES, ROLES, type Locale, type Role } from "./roles.js";

mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash?: string | null;
  displayName?: string | null;
  roles: Role[];
  locale: Locale;
  emailVerifiedAt?: Date | null;
  googleSub?: string | null;
  phoneEnc?: string | null;
  orgId?: Types.ObjectId | null;
  mfa: {
    enabled: boolean;
    secretEnc?: string | null;
    pendingSecretEnc?: string | null;
    lastUsedStep?: number | null;
    recoveryHashes: string[];
  };
  lockout: { failedCount: number; lockedUntil?: Date | null };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, select: false, default: null },
    displayName: { type: String, trim: true, maxlength: 80, default: null },
    roles: { type: [{ type: String, enum: ROLES }], default: ["user"] },
    locale: { type: String, enum: LOCALES, default: "es-DO" },
    emailVerifiedAt: { type: Date, default: null },
    googleSub: { type: String, default: null },
    phoneEnc: { type: String, default: null },
    orgId: { type: Schema.Types.ObjectId, default: null },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, select: false, default: null },
      pendingSecretEnc: { type: String, select: false, default: null },
      lastUsedStep: { type: Number, default: null },
      recoveryHashes: { type: [String], select: false, default: [] },
    },
    lockout: {
      failedCount: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
    },
  },
  { timestamps: true, strict: "throw" },
);
userSchema.index({ googleSub: 1 }, { unique: true, partialFilterExpression: { googleSub: { $type: "string" } } });

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  currentHash: string;
  prevHashes: string[];
  mfa: boolean;
  userAgent: string;
  ipIndex: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string | null;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    currentHash: { type: String, required: true, unique: true },
    prevHashes: { type: [String], default: [], index: true },
    mfa: { type: Boolean, default: false },
    userAgent: { type: String, maxlength: 200, default: "" },
    ipIndex: { type: String, default: "" },
    createdAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { strict: "throw" },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OneTimePurpose = "verify_email" | "reset_password";

export interface OneTimeTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: OneTimePurpose;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
}

const oneTimeTokenSchema = new Schema<OneTimeTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    purpose: { type: String, enum: ["verify_email", "reset_password"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { strict: "throw" },
);
oneTimeTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface AuditDoc {
  _id: Types.ObjectId;
  at: Date;
  action: string;
  outcome: "success" | "failure";
  actorId?: Types.ObjectId | null;
  targetId?: string | null;
  requestId: string;
  ipIndex: string;
  meta: Record<string, string | number | boolean>;
  expiresAt: Date;
}

const auditSchema = new Schema<AuditDoc>(
  {
    at: { type: Date, required: true, index: true },
    action: { type: String, required: true, index: true },
    outcome: { type: String, enum: ["success", "failure"], required: true },
    actorId: { type: Schema.Types.ObjectId, default: null, index: true },
    targetId: { type: String, default: null },
    requestId: { type: String, required: true },
    ipIndex: { type: String, default: "" },
    meta: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
  },
  { strict: "throw" },
);
auditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserModel: Model<UserDoc> = mongoose.models.User ?? mongoose.model<UserDoc>("User", userSchema);
export const SessionModel: Model<SessionDoc> = mongoose.models.Session ?? mongoose.model<SessionDoc>("Session", sessionSchema);
export const OneTimeTokenModel: Model<OneTimeTokenDoc> =
  mongoose.models.OneTimeToken ?? mongoose.model<OneTimeTokenDoc>("OneTimeToken", oneTimeTokenSchema);
export const AuditModel: Model<AuditDoc> = mongoose.models.AuditLog ?? mongoose.model<AuditDoc>("AuditLog", auditSchema);

export async function ensureIndexes(): Promise<void> {
  await Promise.all([UserModel.syncIndexes(), SessionModel.syncIndexes(), OneTimeTokenModel.syncIndexes(), AuditModel.syncIndexes()]);
}
