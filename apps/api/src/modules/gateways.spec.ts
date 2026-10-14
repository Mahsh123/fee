import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { GatewaysService } from './gateways';

const tenantId = '11111111-1111-4111-8111-111111111111';
const personId = '66666666-6666-4666-8666-666666666666';

function gatewayService(linkedPersonId: string | null) {
  const orderFindFirst = vi.fn(async () => linkedPersonId ? ({ id: 'order-a', orderNumber: 'PO-001', personId: linkedPersonId }) : null);
  const paymentFindMany = vi.fn(async () => []);
  const userFindFirst = vi.fn(async () => ({ tenantPersonId: linkedPersonId }));
  const context = new TenantContextService();
  const service = new GatewaysService(
    { db: { paymentOrder: { findFirst: orderFindFirst }, payment: { findMany: paymentFindMany }, user: { findFirst: userFindFirst } } } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, context, {} as never,
  );
  const asWorkspacePerson = <T>(work: () => T) => context.run({
    tenantId, userId: 'user-a', requestId: 'generic-person-gateway-order-test', roles: ['WORKSPACE_PERSON'],
  }, work);
  return { service, asWorkspacePerson, orderFindFirst, paymentFindMany, userFindFirst };
}

describe('generic person payment-order access', () => {
  it('allows a workspace person to refresh only an order attached to their profile', async () => {
    const { service, asWorkspacePerson, orderFindFirst, paymentFindMany, userFindFirst } = gatewayService(personId);

    const result = await asWorkspacePerson(() => service.getOrder(tenantId, 'order-a'));

    expect(userFindFirst).toHaveBeenCalledWith({ where: { tenantId, id: 'user-a', status: 'ACTIVE', deletedAt: null }, select: { tenantPersonId: true } });
    expect(orderFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, id: 'order-a', channel: 'ONLINE', personId }, select: expect.objectContaining({ personId: true }) }));
    expect(paymentFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, paymentOrderId: 'order-a' } }));
    expect(result).toMatchObject({ id: 'order-a', personId });
  });

  it('returns not found and an empty ownership scope for an unlinked portal account', async () => {
    const { service, asWorkspacePerson, orderFindFirst, paymentFindMany } = gatewayService(null);

    await expect(asWorkspacePerson(() => service.getOrder(tenantId, 'order-other'))).rejects.toMatchObject({ status: 404 });

    expect(orderFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, id: 'order-other', channel: 'ONLINE', studentId: { in: [] } } }));
    expect(paymentFindMany).not.toHaveBeenCalled();
  });
});
