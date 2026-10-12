import { randomUUID } from 'node:crypto';
import type { TransactionClient } from '@fee/database';

export type TenantInvitationEvent = {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  acceptUrl: string;
  tokenHash: string;
};

export type PasswordResetEvent = {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  resetUrl: string;
  tokenHash: string;
};

/** Uses the configured origin, but pins the URL to the intended workspace or platform host. */
export function buildUserInvitationUrl(configuredWebUrl: string, hostname: string, token: string, production: boolean): string {
  const url = new URL(configuredWebUrl);
  url.protocol = production ? 'https:' : url.protocol;
  url.hostname = hostname;
  url.pathname = '/accept-invitation';
  url.search = '';
  url.hash = token;
  if (production) url.port = '';
  return url.toString();
}

export function buildEmailChangeVerificationUrl(configuredWebUrl: string, hostname: string, token: string, production: boolean): string {
  const url = new URL(buildUserInvitationUrl(configuredWebUrl, hostname, token, production));
  url.pathname = '/verify-email-change';
  return url.toString();
}

export function buildPasswordResetUrl(configuredWebUrl: string, hostname: string, token: string, production: boolean): string {
  const url = new URL(buildUserInvitationUrl(configuredWebUrl, hostname, token, production));
  url.pathname = '/reset-password';
  return url.toString();
}

/** Stores delivery in the same database transaction as the account/token change. */
export async function enqueueUserInvitation(tx: TransactionClient, input: TenantInvitationEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      id: randomUUID(), tenantId: input.tenantId, eventType: 'USER_INVITATION', aggregateType: 'User', aggregateId: input.userId,
      payload: { userId: input.userId, email: input.email, firstName: input.firstName, acceptUrl: input.acceptUrl, tokenHash: input.tokenHash },
      dedupeKey: `user-invitation:${input.userId}:${input.tokenHash.slice(0, 24)}`,
    },
  });
}

export async function enqueueUserEmailVerification(tx: TransactionClient, input: TenantInvitationEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      id: randomUUID(), tenantId: input.tenantId, eventType: 'USER_EMAIL_VERIFICATION', aggregateType: 'User', aggregateId: input.userId,
      payload: { userId: input.userId, email: input.email, firstName: input.firstName, acceptUrl: input.acceptUrl, tokenHash: input.tokenHash },
      dedupeKey: `user-email-verification:${input.userId}:${input.tokenHash.slice(0, 24)}`,
    },
  });
}

/** Stores password-reset delivery atomically with the one-time token. */
export async function enqueuePasswordReset(tx: TransactionClient, input: PasswordResetEvent): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      id: randomUUID(), tenantId: input.tenantId, eventType: 'USER_PASSWORD_RESET', aggregateType: 'User', aggregateId: input.userId,
      payload: { userId: input.userId, email: input.email, firstName: input.firstName, resetUrl: input.resetUrl, tokenHash: input.tokenHash },
      dedupeKey: `user-password-reset:${input.userId}:${input.tokenHash.slice(0, 24)}`,
    },
  });
}
