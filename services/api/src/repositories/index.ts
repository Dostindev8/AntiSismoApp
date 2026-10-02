import mongoose, { Types } from "mongoose";
import {
  AuditModel,
  OneTimeTokenModel,
  SessionModel,
  UserModel,
  type AuditDoc,
  type OneTimePurpose,
  type SessionDoc,
  type UserDoc,
} from "../models/index.js";
import type { Locale, Role } from "../models/roles.js";

const { trusted } = mongoose;
const PREV_HASHES_KEPT = 20;

export function toObjectId(id: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id ? new Types.ObjectId(id) : null;
}

export const usersRepo = {
  findById(id: Types.ObjectId) {
    return UserModel.findById(id).lean<UserDoc>().exec();
  },
  findByEmail(email: string) {
    return UserModel.findOne({ email: email.toLowerCase() }).lean<UserDoc>().exec();
  },
  findByEmailWithSecrets(email: string) {
    return UserModel.findOne({ email: email.toLowerCase() }).select("+passwordHash +mfa.secretEnc +mfa.recoveryHashes").lean<UserDoc>().exec();
  },
  findByIdWithSecrets(id: Types.ObjectId) {
    return UserModel.findById(id).select("+passwordHash +mfa.secretEnc +mfa.pendingSecretEnc +mfa.recoveryHashes").lean<UserDoc>().exec();
  },
  findByGoogleSub(sub: string) {
    return UserModel.findOne({ googleSub: sub }).lean<UserDoc>().exec();
  },
  async create(data: { email: string; passwordHash: string | null; displayName: string | null; locale: Locale; emailVerifiedAt?: Date; googleSub?: string }) {
    const doc = await UserModel.create(data);
    return doc.toObject<UserDoc>();
  },
  async update(id: Types.ObjectId, set: Record<string, unknown>) {
    await UserModel.updateOne({ _id: id }, { $set: set }).exec();
  },
  async registerFailure(id: Types.ObjectId): Promise<number> {
    const doc = await UserModel.findOneAndUpdate({ _id: id }, { $inc: { "lockout.failedCount": 1 } }, { returnDocument: "after" }).lean<UserDoc>().exec();
    return doc?.lockout.failedCount ?? 0;
  },
  async setRoles(id: Types.ObjectId, roles: Role[]) {
    const res = await UserModel.updateOne({ _id: id }, { $set: { roles } }).exec();
    return res.matchedCount === 1;
  },
  async consumeTotpStep(id: Types.ObjectId, step: number): Promise<boolean> {
    const res = await UserModel.updateOne(
      { _id: id, $or: [{ "mfa.lastUsedStep": null }, { "mfa.lastUsedStep": trusted({ $lt: step }) }] },
      { $set: { "mfa.lastUsedStep": step } },
    ).exec();
    return res.modifiedCount === 1;
  },
  async consumeRecoveryCode(id: Types.ObjectId, hash: string): Promise<boolean> {
    const res = await UserModel.updateOne({ _id: id, "mfa.recoveryHashes": hash }, { $pull: { "mfa.recoveryHashes": hash } }).exec();
    return res.modifiedCount === 1;
  },
};

export const sessionsRepo = {
  async create(data: Omit<SessionDoc, "_id" | "prevHashes" | "revokedAt" | "revokedReason">) {
    const doc = await SessionModel.create({ ...data, prevHashes: [] });
    return doc.toObject<SessionDoc>();
  },
  /** Rotación atómica: solo el hash vigente, no revocado y no expirado puede rotar. */
  rotate(oldHash: string, newHash: string, now: Date, expiresAt: Date) {
    return SessionModel.findOneAndUpdate(
      { currentHash: oldHash, revokedAt: null, expiresAt: trusted({ $gt: now }) },
      {
        $set: { currentHash: newHash, lastUsedAt: now, expiresAt },
        $push: { prevHashes: { $each: [oldHash], $slice: -PREV_HASHES_KEPT } },
      },
      { returnDocument: "after" },
    )
      .lean<SessionDoc>()
      .exec();
  },
  findByPreviousHash(hash: string) {
    return SessionModel.findOne({ prevHashes: hash }).lean<SessionDoc>().exec();
  },
  findByCurrentHash(hash: string) {
    return SessionModel.findOne({ currentHash: hash }).lean<SessionDoc>().exec();
  },
  async revoke(id: Types.ObjectId, reason: string, now: Date, userId?: Types.ObjectId) {
    const filter = userId ? { _id: id, userId, revokedAt: null } : { _id: id, revokedAt: null };
    const res = await SessionModel.updateOne(filter, { $set: { revokedAt: now, revokedReason: reason } }).exec();
    return res.modifiedCount === 1;
  },
  async revokeAllForUser(userId: Types.ObjectId, reason: string, now: Date) {
    await SessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now, revokedReason: reason } }).exec();
  },
  isActive(id: Types.ObjectId, now: Date) {
    return SessionModel.exists({ _id: id, revokedAt: null, expiresAt: trusted({ $gt: now }) }).exec();
  },
  listActive(userId: Types.ObjectId, now: Date) {
    return SessionModel.find({ userId, revokedAt: null, expiresAt: trusted({ $gt: now }) })
      .sort({ lastUsedAt: -1 })
      .limit(50)
      .lean<SessionDoc[]>()
      .exec();
  },
};

export const oneTimeTokensRepo = {
  async create(userId: Types.ObjectId, purpose: OneTimePurpose, tokenHash: string, expiresAt: Date) {
    await OneTimeTokenModel.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } }).exec();
    await OneTimeTokenModel.create({ userId, purpose, tokenHash, expiresAt });
  },
  peek(tokenHash: string, purpose: OneTimePurpose, now: Date) {
    return OneTimeTokenModel.findOne({ tokenHash, purpose, usedAt: null, expiresAt: trusted({ $gt: now }) }).lean().exec();
  },
  consume(tokenHash: string, purpose: OneTimePurpose, now: Date) {
    return OneTimeTokenModel.findOneAndUpdate(
      { tokenHash, purpose, usedAt: null, expiresAt: trusted({ $gt: now }) },
      { $set: { usedAt: now } },
      { returnDocument: "after" },
    )
      .lean()
      .exec();
  },
};

export const auditRepo = {
  async insert(entry: Omit<AuditDoc, "_id">) {
    await AuditModel.create(entry);
  },
  list(limit: number) {
    return AuditModel.find({}).sort({ at: -1 }).limit(limit).lean<AuditDoc[]>().exec();
  },
};
