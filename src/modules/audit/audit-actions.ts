/** Audit action names. Modules add their own as they are built. */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_BLOCKED: 'LOGIN_BLOCKED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  LOGOUT: 'LOGOUT',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
