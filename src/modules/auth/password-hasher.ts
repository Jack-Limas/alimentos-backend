import bcrypt from 'bcrypt';

export const BCRYPT_COST = 12;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
  /**
   * Compares against a fixed fake hash so a login for an unknown email takes
   * as long as one for an existing email (no user enumeration by timing).
   */
  compareWithDummy(password: string): Promise<false>;
}

export function createBcryptHasher(cost: number = BCRYPT_COST): PasswordHasher {
  let dummyHash: Promise<string> | undefined;

  return {
    hash: (password) => bcrypt.hash(password, cost),
    compare: (password, hash) => bcrypt.compare(password, hash),
    async compareWithDummy(password) {
      dummyHash ??= bcrypt.hash('dummy-password-for-timing-only', cost);
      await bcrypt.compare(password, await dummyHash);
      return false;
    },
  };
}
