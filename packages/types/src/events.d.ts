/**
 * Domain events.
 *
 * Events are written to the `outbox_events` table inside the same transaction
 * as the state change that produced them, then published by the worker. Nothing
 * consumes an event that was not committed, and no handler runs twice for the
 * same `dedupeKey`.
 *
 * Declaring these contracts here (rather than inside the API app) is what makes
 * extracting the payment service in a later phase a deployment change instead
 * of a rewrite.
 */
export declare const DOMAIN_EVENT_TYPES: readonly ["tenant.created", "admission.created", "admission.confirmed", "student.created", "feeStructure.published", "feePolicy.published", "feeAssignment.created", "feeDemand.generated", "feeDemand.issued", "feeDemand.updated", "feeDemand.cancelled", "feeBecameOverdue", "scholarship.applied", "discount.applied", "waiver.applied", "feeOverride.created", "installment.dueSoon", "installment.overdue", "lateFee.accrued", "paymentOrder.created", "payment.created", "payment.succeeded", "payment.failed", "payment.cancelled", "payment.allocated", "payment.unallocated", "payment.refunded", "refund.created", "refund.completed", "refund.failed", "credit.issued", "credit.allocated", "adjustment.applied", "receipt.generated", "receipt.voided", "invoice.issued", "gateway.webhookReceived", "gateway.webhookFailed", "settlement.imported", "reconciliation.mismatchFound", "approval.requested", "approval.approved", "approval.rejected", "notification.send", "report.requested", "export.requested"];
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];
export interface DomainEvent<TType extends DomainEventType = DomainEventType, TPayload = unknown> {
    /** Event id. Stable across retries. */
    id: string;
    type: TType;
    tenantId: string;
    /** ISO timestamp of when the event was recorded. */
    occurredAt: string;
    aggregateType: string;
    aggregateId?: string | null;
    /** Actor that caused the event, when there was one. */
    actorId?: string | null;
    requestId?: string | null;
    /** Consumer-side idempotency. Unique per tenant. */
    dedupeKey?: string | null;
    payload: TPayload;
}
export interface PaymentSucceededPayload {
    paymentId: string;
    paymentNumber: string;
    studentId?: string | null;
    amount: string;
    currency: string;
    channel: string;
    methodKind: string;
    provider?: string | null;
    providerTxnId?: string | null;
    paidAt: string;
    receiptNumber?: string | null;
}
export interface PaymentAllocatedPayload {
    paymentId: string;
    allocations: Array<{
        demandItemId: string;
        demandId: string;
        amount: string;
    }>;
    unallocatedAmount: string;
    creditId?: string | null;
}
export interface FeeDemandGeneratedPayload {
    demandId: string;
    demandNumber: string;
    studentId: string;
    netAmount: string;
    currency: string;
    dueDate: string;
    items: Array<{
        feeTypeCode: string;
        netAmount: string;
    }>;
}
export interface RefundCompletedPayload {
    refundId: string;
    refundNumber: string;
    paymentId: string;
    amount: string;
    currency: string;
    kind: string;
    toCreditBalance: boolean;
}
export interface ApprovalRequestedPayload {
    approvalRequestId: string;
    actionType: string;
    entityType: string;
    entityId?: string | null;
    amount?: string | null;
    requestedBy?: string | null;
    summary: string;
}
export interface NotificationSendPayload {
    notificationId: string;
    event: string;
    channel: string;
    toAddress: string;
    studentId?: string | null;
    paymentId?: string | null;
    demandId?: string | null;
}
/** Maps an event type to its payload, so producers and consumers agree. */
export interface DomainEventPayloadMap {
    'payment.succeeded': PaymentSucceededPayload;
    'payment.allocated': PaymentAllocatedPayload;
    'feeDemand.generated': FeeDemandGeneratedPayload;
    'feeDemand.issued': FeeDemandGeneratedPayload;
    'refund.completed': RefundCompletedPayload;
    'approval.requested': ApprovalRequestedPayload;
    'notification.send': NotificationSendPayload;
}
export type KnownDomainEvent = {
    [K in keyof DomainEventPayloadMap]: DomainEvent<K, DomainEventPayloadMap[K]>;
}[keyof DomainEventPayloadMap];
/** Queue names used by the API (producer) and worker (consumer). */
export declare const QUEUE_NAMES: {
    readonly NOTIFICATIONS: "notifications";
    readonly RECEIPTS: "receipts";
    readonly REPORTS: "reports";
    readonly EXPORTS: "exports";
    readonly REMINDERS: "reminders";
    readonly RECONCILIATION: "reconciliation";
    readonly WEBHOOK_RETRY: "webhook-retry";
    readonly FEE_GENERATION: "fee-generation";
    readonly OUTBOX: "outbox";
};
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
export interface JobName {
    queue: QueueName;
    name: string;
}
export declare const JOB_NAMES: {
    readonly GENERATE_RECEIPT_PDF: "generate-receipt-pdf";
    readonly RENDER_INVOICE_PDF: "render-invoice-pdf";
    readonly SEND_NOTIFICATION: "send-notification";
    readonly SEND_EMAIL: "send-email";
    readonly SEND_SMS: "send-sms";
    readonly SEND_WHATSAPP: "send-whatsapp";
    readonly SCAN_FEE_REMINDERS: "scan-fee-reminders";
    readonly SCAN_OVERDUE: "scan-overdue";
    readonly SCAN_INSTALLMENT_DUE: "scan-installment-due";
    readonly ACCRUE_LATE_FEES: "accrue-late-fees";
    readonly GENERATE_REPORT: "generate-report";
    readonly GENERATE_EXPORT: "generate-export";
    readonly BULK_GENERATE_DEMANDS: "bulk-generate-demands";
    readonly IMPORT_SETTLEMENT: "import-settlement";
    readonly REPROCESS_WEBHOOK: "reprocess-webhook";
    readonly PUBLISH_OUTBOX: "publish-outbox";
    readonly RECONCILE_SETTLEMENT: "reconcile-settlement";
};
//# sourceMappingURL=events.d.ts.map