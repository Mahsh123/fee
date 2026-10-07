import type { PayerType } from '@fee/types';
import { AppError } from '../common/errors';

type PortalPayerContext = { portalOnly: boolean; isParentPortal: boolean };

/** Resolve an omitted checkout payer while keeping portal users inside their own payer scope. */
export function resolveOrderPayerType(input: PayerType | undefined, context: PortalPayerContext): PayerType {
  const resolved = input ?? (context.isParentPortal ? 'PARENT' : 'STUDENT');
  if (context.portalOnly) {
    const allowed = context.isParentPortal ? ['PARENT', 'GUARDIAN'] : ['STUDENT'];
    if (!allowed.includes(resolved)) throw AppError.forbidden('Portal users may only create an order for their own payer responsibility.');
  }
  return resolved;
}
