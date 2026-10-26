export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface RefreshTokenRepository {
  create(token: NewRefreshToken): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Revokes every still-active token of the family. Returns how many were revoked. */
  revokeFamily(familyId: string, revokedAt: Date): Promise<number>;
  /**
   * In one transaction: revokes `currentId` (pointing it to `next.id`) and
   * creates `next`. Returns false, creating nothing, when `currentId` was
   * already revoked (e.g. a concurrent rotation won the race).
   */
  rotate(currentId: string, revokedAt: Date, next: NewRefreshToken): Promise<boolean>;
}
