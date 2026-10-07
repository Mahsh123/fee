"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOB_NAMES = exports.QUEUE_NAMES = exports.DOMAIN_EVENT_TYPES = void 0;
exports.DOMAIN_EVENT_TYPES = [
    'tenant.created',
    'admission.created',
    'admission.confirmed',
    'student.created',
    'feeStructure.published',
    'feePolicy.published',
    'feeAssignment.created',
    'feeDemand.generated',
    'feeDemand.issued',
    'feeDemand.updated',
    'feeDemand.cancelled',
    'feeBecameOverdue',
    'scholarship.applied',
    'discount.applied',
    'waiver.applied',
    'feeOverride.created',
    'installment.dueSoon',
    'installment.overdue',
    'lateFee.accrued',
    'paymentOrder.created',
    'payment.created',
    'payment.succeeded',
    'payment.failed',
    'payment.cancelled',
    'payment.allocated',
    'payment.unallocated',
    'payment.refunded',
    'refund.created',
    'refund.completed',
    'refund.failed',
    'credit.issued',
    'credit.allocated',
    'adjustment.applied',
    'receipt.generated',
    'receipt.voided',
    'invoice.issued',
    'gateway.webhookReceived',
    'gateway.webhookFailed',
    'settlement.imported',
    'reconciliation.mismatchFound',
    'approval.requested',
    'approval.approved',
    'approval.rejected',
    'notification.send',
    'report.requested',
    'export.requested',
];
/** Queue names used by the API (producer) and worker (consumer). */
exports.QUEUE_NAMES = {
    NOTIFICATIONS: 'notifications',
    RECEIPTS: 'receipts',
    REPORTS: 'reports',
    EXPORTS: 'exports',
    REMINDERS: 'reminders',
    RECONCILIATION: 'reconciliation',
    WEBHOOK_RETRY: 'webhook-retry',
    FEE_GENERATION: 'fee-generation',
    OUTBOX: 'outbox',
};
exports.JOB_NAMES = {
    GENERATE_RECEIPT_PDF: 'generate-receipt-pdf',
    RENDER_INVOICE_PDF: 'render-invoice-pdf',
    SEND_NOTIFICATION: 'send-notification',
    SEND_EMAIL: 'send-email',
    SEND_SMS: 'send-sms',
    SEND_WHATSAPP: 'send-whatsapp',
    SCAN_FEE_REMINDERS: 'scan-fee-reminders',
    SCAN_OVERDUE: 'scan-overdue',
    SCAN_INSTALLMENT_DUE: 'scan-installment-due',
    ACCRUE_LATE_FEES: 'accrue-late-fees',
    GENERATE_REPORT: 'generate-report',
    GENERATE_EXPORT: 'generate-export',
    BULK_GENERATE_DEMANDS: 'bulk-generate-demands',
    IMPORT_SETTLEMENT: 'import-settlement',
    REPROCESS_WEBHOOK: 'reprocess-webhook',
    PUBLISH_OUTBOX: 'publish-outbox',
    RECONCILE_SETTLEMENT: 'reconcile-settlement',
};
//# sourceMappingURL=events.js.map