export interface NewLoginAttempt {
  email: string;
  ip: string;
  success: boolean;
  createdAt: Date;
}

export interface LoginAttemptRepository {
  record(attempt: NewLoginAttempt): Promise<void>;
  /** Failed attempts for (email, ip) at or after `since`, oldest first (only `createdAt`). */
  failuresSince(email: string, ip: string, since: Date): Promise<Date[]>;
  /** Time of the latest successful login for (email, ip), if any. */
  lastSuccessAt(email: string, ip: string): Promise<Date | null>;
}
