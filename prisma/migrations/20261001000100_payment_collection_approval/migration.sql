-- A configured partial-payment approval is a distinct financial workflow.
-- Keeping its action type explicit lets approval policy and audit logs distinguish
-- it from refunds, adjustments and credit applications.
ALTER TYPE "ApprovalActionType" ADD VALUE 'PAYMENT_COLLECTION';
