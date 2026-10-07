-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'FINANCE_ADMIN', 'FINANCE_STAFF', 'ADMISSION_STAFF', 'COLLECTION_STAFF', 'ACCOUNTANT', 'REPORT_VIEWER', 'STUDENT', 'PARENT');

-- CreateEnum
CREATE TYPE "FeeCategoryKind" AS ENUM ('ACADEMIC', 'ADMISSION', 'EXAMINATION', 'TRANSPORT', 'HOSTEL', 'LIBRARY', 'LABORATORY', 'ACTIVITIES', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "FeeCalculationMethod" AS ENUM ('FIXED', 'PERCENTAGE', 'QUANTITY', 'USAGE', 'FORMULA', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FeeFrequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'TERM', 'SEMESTER', 'CUSTOM_DATE', 'EVENT_BASED');

-- CreateEnum
CREATE TYPE "FeeOptionality" AS ENUM ('MANDATORY', 'OPTIONAL', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('ELIGIBILITY', 'SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'EXEMPTION', 'SURCHARGE', 'OVERRIDE', 'LATE_FEE', 'EARLY_PAYMENT_DISCOUNT', 'INSTALLMENT_RULE');

-- CreateEnum
CREATE TYPE "StackingMode" AS ENUM ('STACKABLE', 'NON_STACKABLE', 'EXCLUSIVE', 'HIGHEST_BENEFIT', 'PRIORITY_ONLY');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'IN', 'NOT_IN', 'CONTAINS', 'BETWEEN', 'EXISTS');

-- CreateEnum
CREATE TYPE "LogicalOperator" AS ENUM ('AND', 'OR');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('ADD_FIXED_AMOUNT', 'ADD_PERCENTAGE', 'DISCOUNT_FIXED', 'DISCOUNT_PERCENTAGE', 'WAIVE_FULL', 'WAIVE_PARTIAL', 'EXEMPT', 'OVERRIDE_AMOUNT', 'SET_DUE_DATE', 'ADD_LATE_FEE', 'REMOVE_LATE_FEE', 'CAP_AMOUNT', 'SET_MINIMUM_AMOUNT', 'SET_MAXIMUM_AMOUNT');

-- CreateEnum
CREATE TYPE "ActionAmountBasis" AS ENUM ('BASE_AMOUNT', 'RUNNING_TOTAL', 'FEE_ITEM');

-- CreateEnum
CREATE TYPE "ScholarshipKind" AS ENUM ('FULL', 'PERCENTAGE', 'FIXED_AMOUNT', 'FEE_SPECIFIC', 'TERM_SPECIFIC', 'YEAR_SPECIFIC');

-- CreateEnum
CREATE TYPE "AssignmentTargetType" AS ENUM ('STUDENT', 'CLASS', 'SECTION', 'BATCH', 'COURSE', 'DEPARTMENT', 'PROGRAM', 'HOSTEL', 'TRANSPORT_ROUTE', 'CUSTOM_GROUP');

-- CreateEnum
CREATE TYPE "DemandStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED', 'CREDITED');

-- CreateEnum
CREATE TYPE "DemandItemStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'INITIATED', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('ONLINE', 'MANUAL', 'SPONSOR', 'ADVANCE', 'ADMISSION');

-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('CASH', 'UPI_MANUAL', 'BANK_TRANSFER', 'CHEQUE', 'DD', 'CARD_OFFLINE', 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'INTERNATIONAL_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('STUDENT', 'PARENT', 'GUARDIAN', 'SPONSOR', 'GOVERNMENT', 'SCHOLARSHIP_FUND', 'INSTITUTION', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('RAZORPAY', 'CASHFREE', 'PAYU', 'STRIPE', 'MOCK');

-- CreateEnum
CREATE TYPE "GatewayEnvironment" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "GatewayTransactionStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'DUPLICATE', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('FULL', 'PARTIAL', 'GATEWAY', 'MANUAL');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'VOID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CreditSource" AS ENUM ('OVERPAYMENT', 'ADVANCE_PAYMENT', 'REFUND_TO_CREDIT', 'ADJUSTMENT', 'SPONSOR_SURPLUS', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT', 'WRITE_OFF', 'WAIVER', 'CORRECTION', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'APPLIED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY');

-- CreateEnum
CREATE TYPE "LedgerSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('GENERATED', 'PDF_PENDING', 'PDF_READY', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('IMPORTED', 'PARTIALLY_MATCHED', 'MATCHED', 'MISMATCHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'MATCHED', 'MISMATCHED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_PENDING', 'RECEIPT_GENERATED', 'FEE_DUE', 'FEE_OVERDUE', 'INSTALLMENT_DUE', 'ADMISSION_PAYMENT', 'REFUND', 'SCHOLARSHIP_APPLIED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('REFUND', 'FEE_WAIVER', 'MANUAL_ADJUSTMENT', 'STUDENT_OVERRIDE', 'SCHOLARSHIP', 'WRITE_OFF', 'FEE_STRUCTURE_CHANGE', 'CREDIT_APPLICATION');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('REPORT', 'EXPORT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'WITHDRAWN', 'ALUMNI');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'SPONSOR_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FEES_PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ENROLLED');

-- CreateEnum
CREATE TYPE "LateFeeMode" AS ENUM ('NONE', 'FLAT', 'PER_DAY', 'PERCENTAGE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PartialPaymentPolicy" AS ENUM ('ALLOW', 'ALLOW_WITH_APPROVAL', 'DISALLOW');

-- CreateEnum
CREATE TYPE "OverpaymentPolicy" AS ENUM ('REJECT', 'CREDIT_BALANCE', 'ADVANCE_PAYMENT');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL', 'NONE');

-- CreateEnum
CREATE TYPE "InstallmentBasis" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE', 'CUSTOM_SCHEDULE');

-- CreateEnum
CREATE TYPE "SequenceKind" AS ENUM ('RECEIPT', 'INVOICE', 'PAYMENT', 'DEMAND', 'APPLICATION', 'STUDENT', 'REFUND', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM');

-- CreateEnum
CREATE TYPE "AcademicUnitType" AS ENUM ('PROGRAM', 'CLASS', 'SECTION', 'BATCH', 'DEPARTMENT', 'HOSTEL', 'TRANSPORT_ROUTE');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "countryCode" CHAR(2),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "currencySymbol" TEXT NOT NULL DEFAULT '₹',
    "currencyMinorUnits" INTEGER NOT NULL DEFAULT 2,
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "dateFormat" TEXT NOT NULL DEFAULT 'dd-MM-yyyy',
    "defaultAcademicYearId" UUID,
    "lateFeeMode" "LateFeeMode" NOT NULL DEFAULT 'NONE',
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 0,
    "lateFeeFlatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lateFeePerDay" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lateFeePercent" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "lateFeeMaxAmount" DECIMAL(18,4),
    "partialPaymentPolicy" "PartialPaymentPolicy" NOT NULL DEFAULT 'ALLOW',
    "overpaymentPolicy" "OverpaymentPolicy" NOT NULL DEFAULT 'CREDIT_BALANCE',
    "allowAdvancePayment" BOOLEAN NOT NULL DEFAULT false,
    "minimumPartialAmount" DECIMAL(18,4),
    "refundApprovalThreshold" DECIMAL(18,4),
    "waiverApprovalThreshold" DECIMAL(18,4),
    "adjustmentApprovalThreshold" DECIMAL(18,4),
    "reminderScheduleDays" INTEGER[] DEFAULT ARRAY[7, 3, 0, 1, 7]::INTEGER[],
    "allowNegativeDemand" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_branding" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "institutionName" TEXT NOT NULL,
    "legalName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoDocumentId" UUID,
    "primaryColor" TEXT NOT NULL DEFAULT '#0F172A',
    "accentColor" TEXT NOT NULL DEFAULT '#2563EB',
    "receiptFooter" TEXT,
    "invoiceFooter" TEXT,
    "authorizedSignatory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_numbering_settings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receiptPrefix" TEXT NOT NULL DEFAULT 'RCPT',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "paymentPrefix" TEXT NOT NULL DEFAULT 'PAY',
    "demandPrefix" TEXT NOT NULL DEFAULT 'DMD',
    "refundPrefix" TEXT NOT NULL DEFAULT 'REF',
    "applicationPrefix" TEXT NOT NULL DEFAULT 'APP',
    "studentPrefix" TEXT NOT NULL DEFAULT 'STU',
    "padding" INTEGER NOT NULL DEFAULT 6,
    "includeYear" BOOLEAN NOT NULL DEFAULT true,
    "separator" TEXT NOT NULL DEFAULT '-',
    "resetAnnually" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_numbering_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_payment_gateways" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "environment" "GatewayEnvironment" NOT NULL DEFAULT 'TEST',
    "displayName" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "webhookSecretCiphertext" TEXT,
    "extraConfig" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isBackup" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "supportedMethods" "PaymentMethodKind"[],
    "routingRules" JSONB,
    "minAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tenant_payment_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_notification_settings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'SMTP',
    "providerConfig" JSONB,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "studentId" UUID,
    "guardianId" UUID,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "scopeUnitIds" UUID[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" UUID,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "unitType" "AcademicUnitType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" UUID,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "academic_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "admissionNumber" TEXT NOT NULL,
    "rollNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "category" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "academicYearId" UUID,
    "primaryUnitId" UUID,
    "admissionType" TEXT,
    "scholarshipCategory" TEXT,
    "hostelStatus" BOOLEAN NOT NULL DEFAULT false,
    "transportStatus" BOOLEAN NOT NULL DEFAULT false,
    "transportRouteId" UUID,
    "isInternational" BOOLEAN NOT NULL DEFAULT false,
    "academicScore" DECIMAL(6,2),
    "familyGroupId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_unit_memberships" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "academicUnitId" UUID NOT NULL,
    "academicYearId" UUID,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_unit_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "relation" "GuardianRelation" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "occupation" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "isPrimaryPayer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_groups" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "membershipRule" JSONB,
    "isDynamic" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "student_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_group_members" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" UUID,

    CONSTRAINT "student_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_custom_attributes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "valueType" "CustomFieldType" NOT NULL DEFAULT 'STRING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_custom_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "applicantFirstName" TEXT NOT NULL,
    "applicantLastName" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "category" TEXT,
    "academicYearId" UUID,
    "targetUnitId" UUID,
    "admissionType" TEXT,
    "isInternational" BOOLEAN NOT NULL DEFAULT false,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "demandId" UUID,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "admissionNumber" TEXT NOT NULL,
    "applicationId" UUID,
    "studentId" UUID,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmedAt" TIMESTAMP(3),
    "admittedOn" DATE,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "creditLimit" DECIMAL(18,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "FeeCategoryKind" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fee_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "calculationMethod" "FeeCalculationMethod" NOT NULL DEFAULT 'FIXED',
    "defaultFrequency" "FeeFrequency" NOT NULL DEFAULT 'ANNUAL',
    "optionality" "FeeOptionality" NOT NULL DEFAULT 'MANDATORY',
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercent" DECIMAL(9,6),
    "applicabilityRule" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fee_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_type_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeTypeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "calculationMethod" "FeeCalculationMethod" NOT NULL,
    "defaultFrequency" "FeeFrequency" NOT NULL,
    "optionality" "FeeOptionality" NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "taxPercent" DECIMAL(9,6),
    "applicabilityRule" JSONB,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "fee_type_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "academicYearId" UUID,
    "targetType" "AssignmentTargetType" NOT NULL DEFAULT 'CLASS',
    "targetUnitId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeStructureId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "supersedesVersionId" UUID,
    "totalAmount" DECIMAL(18,4),
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "fee_structure_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeStructureVersionId" UUID NOT NULL,
    "feeTypeId" UUID NOT NULL,
    "feeTypeVersionId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(12,4),
    "percentBase" DECIMAL(18,4),
    "frequency" "FeeFrequency" NOT NULL,
    "optionality" "FeeOptionality" NOT NULL DEFAULT 'MANDATORY',
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercent" DECIMAL(9,6),
    "dueDate" DATE,
    "dueRule" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_structure_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_rule_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeStructureItemId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "basis" "InstallmentBasis" NOT NULL DEFAULT 'PERCENTAGE',
    "amount" DECIMAL(18,4),
    "percentage" DECIMAL(9,6),
    "dueDate" DATE,
    "dueOffsetDays" INTEGER,
    "label" TEXT,

    CONSTRAINT "installment_rule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_policies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "policyType" "PolicyType" NOT NULL,
    "stackingMode" "StackingMode" NOT NULL DEFAULT 'STACKABLE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "arbitrationGroup" TEXT,
    "stage" INTEGER NOT NULL DEFAULT 50,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalThreshold" DECIMAL(18,4),
    "explainTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fee_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_policy_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "conditionTree" JSONB,
    "limits" JSONB,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "fee_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_policy_conditions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "operator" "ConditionOperator" NOT NULL,
    "value" JSONB,
    "valueType" "CustomFieldType" NOT NULL DEFAULT 'STRING',
    "groupIndex" INTEGER NOT NULL DEFAULT 0,
    "logicalWith" "LogicalOperator" NOT NULL DEFAULT 'AND',
    "negate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_policy_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_policy_actions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "amountBasis" "ActionAmountBasis" NOT NULL DEFAULT 'RUNNING_TOTAL',
    "amount" DECIMAL(18,4),
    "percentage" DECIMAL(9,6),
    "feeTypeIds" UUID[],
    "capAmount" DECIMAL(18,4),
    "floorAmount" DECIMAL(18,4),
    "dueDate" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parameters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_policy_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_policy_scopes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "targetType" "AssignmentTargetType" NOT NULL,
    "targetId" UUID,
    "academicYearId" UUID,
    "includeChildren" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_policy_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarships" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "ScholarshipKind" NOT NULL,
    "funder" TEXT,
    "policyId" UUID,
    "percentage" DECIMAL(9,6),
    "fixedAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "feeTypeIds" UUID[],
    "academicYearId" UUID,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scholarships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyId" UUID,
    "percentage" DECIMAL(9,6),
    "fixedAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "feeTypeIds" UUID[],
    "stackingMode" "StackingMode" NOT NULL DEFAULT 'STACKABLE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyId" UUID,
    "percentage" DECIMAL(9,6),
    "fixedAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "feeTypeIds" UUID[],
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "concessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waivers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyId" UUID,
    "fullWaiver" BOOLEAN NOT NULL DEFAULT false,
    "percentage" DECIMAL(9,6),
    "fixedAmount" DECIMAL(18,4),
    "feeTypeIds" UUID[],
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "waivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surcharges" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyId" UUID,
    "percentage" DECIMAL(9,6),
    "fixedAmount" DECIMAL(18,4),
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercent" DECIMAL(9,6),
    "feeTypeIds" UUID[],
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "surcharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_overrides" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "feeTypeId" UUID NOT NULL,
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "overrideAmount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "academicYearId" UUID,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "fee_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID,
    "groupId" UUID,
    "scholarshipId" UUID,
    "discountId" UUID,
    "concessionId" UUID,
    "waiverId" UUID,
    "academicYearId" UUID,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "VersionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "overridePercentage" DECIMAL(9,6),
    "overrideFixedAmount" DECIMAL(18,4),
    "overrideMaxAmount" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "benefit_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeStructureId" UUID NOT NULL,
    "feeStructureVersionId" UUID NOT NULL,
    "targetType" "AssignmentTargetType" NOT NULL,
    "targetId" UUID,
    "targetStudentIds" UUID[],
    "academicYearId" UUID,
    "dueDateOverride" DATE,
    "installmentRule" JSONB,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3),
    "generationSummary" JSONB,
    "needsAttention" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "fee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_demands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "demandNumber" TEXT NOT NULL,
    "feeAssignmentId" UUID,
    "academicYearId" UUID,
    "studentGroupKey" TEXT,
    "financialPeriod" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "baseAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "surchargeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scholarshipAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "concessionAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "waiverAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overrideAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lateFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "adjustmentAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "waivedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "arrearsAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "DemandStatus" NOT NULL DEFAULT 'DRAFT',
    "calculation" JSONB,
    "calculationVersion" TEXT,
    "preRoundingNetAmount" DECIMAL(18,4),
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "fee_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_demand_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "demandId" UUID NOT NULL,
    "feeTypeId" UUID NOT NULL,
    "feeTypeCode" TEXT NOT NULL,
    "feeTypeName" TEXT NOT NULL,
    "feeCategoryCode" TEXT,
    "feeTypeVersionId" UUID,
    "sequence" INTEGER NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "optionality" "FeeOptionality" NOT NULL DEFAULT 'MANDATORY',
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(12,4),
    "rate" DECIMAL(18,4),
    "surchargeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scholarshipAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "concessionAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "waiverAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overrideAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lateFeeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "waivedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "DemandItemStatus" NOT NULL DEFAULT 'UNPAID',
    "dueDate" DATE,
    "calculation" JSONB,
    "periodStart" DATE,
    "periodEnd" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_demand_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_demand_item_adjustments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "demandItemId" UUID NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "percent" DECIMAL(9,6),
    "basisAmount" DECIMAL(18,4),
    "runningTotalAfter" DECIMAL(18,4),
    "policyId" UUID,
    "policyVersionId" UUID,
    "policyName" TEXT,
    "policyType" "PolicyType",
    "stackingMode" "StackingMode",
    "instrumentType" TEXT,
    "instrumentId" UUID,
    "reason" TEXT,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "cappedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_demand_item_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fee_accruals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "demandId" UUID NOT NULL,
    "demandItemId" UUID,
    "mode" "LateFeeMode" NOT NULL,
    "daysLate" INTEGER NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "rateApplied" DECIMAL(18,4),
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "cappedBy" TEXT,
    "calculatedFor" DATE NOT NULL,
    "waivedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "late_fee_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "demandId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "basis" "InstallmentBasis" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "waivedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "feeTypeId" UUID NOT NULL,
    "demandItemId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "studentId" UUID,
    "admissionApplicationId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "purpose" TEXT NOT NULL DEFAULT 'FEE_PAYMENT',
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "gatewayConfigId" UUID,
    "provider" "GatewayProvider",
    "environment" "GatewayEnvironment",
    "methodKind" "PaymentMethodKind",
    "intendedDemandItemIds" UUID[],
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "receiptNumber" TEXT,
    "studentId" UUID,
    "paymentOrderId" UUID,
    "channel" "PaymentChannel" NOT NULL,
    "methodKind" "PaymentMethodKind" NOT NULL,
    "methodId" UUID,
    "payerType" "PayerType" NOT NULL DEFAULT 'STUDENT',
    "payerName" TEXT,
    "payerPhone" TEXT,
    "payerEmail" TEXT,
    "payerStudentId" UUID,
    "payerGuardianId" UUID,
    "payerSponsorId" UUID,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "valueDate" DATE,
    "referenceNumber" TEXT,
    "instrumentNumber" TEXT,
    "bankName" TEXT,
    "branchName" TEXT,
    "instrumentDate" DATE,
    "clearanceStatus" TEXT,
    "remarks" TEXT,
    "isAdvancePayment" BOOLEAN NOT NULL DEFAULT false,
    "isOverpayment" BOOLEAN NOT NULL DEFAULT false,
    "collectedBy" UUID,
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMP(3),
    "provider" "GatewayProvider",
    "providerTxnId" TEXT,
    "gatewayConfigId" UUID,
    "reversalOfPaymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "demandId" UUID,
    "demandItemId" UUID,
    "installmentId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "allocationMode" TEXT NOT NULL DEFAULT 'WATERFALL',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedBy" UUID,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "PaymentMethodKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requiresReference" BOOLEAN NOT NULL DEFAULT false,
    "requiresInstrument" BOOLEAN NOT NULL DEFAULT false,
    "enabledForManual" BOOLEAN NOT NULL DEFAULT true,
    "enabledForOnline" BOOLEAN NOT NULL DEFAULT false,
    "preferredGatewayConfigId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_transactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentOrderId" UUID,
    "paymentId" UUID,
    "gatewayConfigId" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "environment" "GatewayEnvironment" NOT NULL,
    "status" "GatewayTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "providerOrderId" TEXT,
    "providerTxnId" TEXT,
    "providerPaymentId" TEXT,
    "providerSignature" TEXT,
    "providerStatusRaw" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "methodKind" "PaymentMethodKind",
    "gatewayFee" DECIMAL(18,4),
    "gatewayTax" DECIMAL(18,4),
    "netSettlement" DECIMAL(18,4),
    "settlementId" UUID,
    "settledAt" TIMESTAMP(3),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_webhooks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "environment" "GatewayEnvironment" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT,
    "signature" TEXT,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "resultingPaymentId" UUID,
    "resultingTransactionId" UUID,
    "durationMs" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "resourceId" UUID,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "paymentId" UUID NOT NULL,
    "kind" "RefundKind" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "reason" TEXT NOT NULL,
    "methodKind" "PaymentMethodKind" NOT NULL,
    "referenceNumber" TEXT,
    "providerRefundId" TEXT,
    "gatewayTransactionId" UUID,
    "toCreditBalance" BOOLEAN NOT NULL DEFAULT false,
    "resultingCreditId" UUID,
    "requestedBy" UUID,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "processedBy" UUID,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "reversalApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvalRequestId" UUID,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID,
    "source" "CreditSource" NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "availableAmount" DECIMAL(18,4) NOT NULL,
    "paymentId" UUID,
    "refundId" UUID,
    "sourceDemandId" UUID,
    "sponsorId" UUID,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_allocations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "creditId" UUID NOT NULL,
    "demandId" UUID,
    "demandItemId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "reversedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "credit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "adjustmentNumber" TEXT NOT NULL,
    "demandId" UUID,
    "demandItemId" UUID,
    "studentId" UUID,
    "paymentId" UUID,
    "creditId" UUID,
    "kind" "AdjustmentKind" NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "direction" "AdjustmentDirection" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "reason" TEXT NOT NULL,
    "policyId" UUID,
    "instrumentType" TEXT,
    "instrumentId" UUID,
    "reversalOfAdjustmentId" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "requestedBy" UUID,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "approvalRequestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "transactionGroupId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "side" "LedgerSide" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "eventType" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studentId" UUID,
    "demandId" UUID,
    "demandItemId" UUID,
    "paymentId" UUID,
    "refundId" UUID,
    "creditId" UUID,
    "adjustmentId" UUID,
    "narration" TEXT,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'POSTED',
    "reversedByGroupId" UUID,
    "createdBy" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paymentId" UUID NOT NULL,
    "studentId" UUID,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'GENERATED',
    "issueDate" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "balanceAfter" DECIMAL(18,4),
    "amountInWords" TEXT,
    "pdfDocumentId" UUID,
    "emailedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "deliveryChannels" "NotificationChannel"[],
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedBy" UUID,
    "replacesReceiptId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "feeTypeCode" TEXT NOT NULL,
    "feeTypeName" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "studentId" UUID,
    "demandId" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "snapshot" JSONB,
    "pdfDocumentId" UUID,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "feeTypeCode" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(18,4) NOT NULL,
    "taxPercent" DECIMAL(9,6),
    "amount" DECIMAL(18,4) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "studentId" UUID,
    "receiptId" UUID,
    "reportJobId" UUID,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "gatewayConfigId" UUID NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "environment" "GatewayEnvironment" NOT NULL,
    "settlementReference" TEXT NOT NULL,
    "settlementDate" DATE NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "gatewayFee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gatewayTax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'IMPORTED',
    "sourceFileDocumentId" UUID,
    "importedBy" UUID,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "settlementId" UUID,
    "gatewayTransactionId" UUID,
    "paymentId" UUID,
    "refundId" UUID,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "mismatchType" TEXT,
    "expectedAmount" DECIMAL(18,4),
    "actualAmount" DECIMAL(18,4),
    "difference" DECIMAL(18,4),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "recipientType" TEXT NOT NULL,
    "recipientId" UUID,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "studentId" UUID,
    "paymentId" UUID,
    "demandId" UUID,
    "receiptId" UUID,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "actorEmail" TEXT,
    "actorRoles" TEXT[],
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityRef" TEXT,
    "before" JSONB,
    "after" JSONB,
    "diff" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "prevHash" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actionType" "ApprovalActionType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "amount" DECIMAL(18,4),
    "currency" CHAR(3),
    "requestedBy" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredRole" "RoleKey",
    "thresholdAmount" DECIMAL(18,4),
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "executedAt" TIMESTAMP(3),
    "executionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "JobKind" NOT NULL DEFAULT 'REPORT',
    "reportKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "parameters" JSONB NOT NULL,
    "asOfDate" DATE,
    "fromDate" DATE,
    "toDate" DATE,
    "rowCount" INTEGER,
    "resultDocumentId" UUID,
    "errorMessage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "requestedBy" UUID,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "filters" JSONB,
    "rowCount" INTEGER,
    "resultDocumentId" UUID,
    "errorMessage" TEXT,
    "requestedBy" UUID,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "SequenceKind" NOT NULL,
    "scope" TEXT,
    "prefix" TEXT NOT NULL,
    "nextValue" BIGINT NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "separator" TEXT NOT NULL DEFAULT '-',
    "resetAnnually" BOOLEAN NOT NULL DEFAULT false,
    "lastResetPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_branding_tenantId_key" ON "tenant_branding"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

-- CreateIndex
CREATE INDEX "tenant_domains_tenantId_idx" ON "tenant_domains"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_numbering_settings_tenantId_key" ON "tenant_numbering_settings"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_payment_gateways_tenantId_enabled_idx" ON "tenant_payment_gateways"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payment_gateways_tenantId_provider_environment_key" ON "tenant_payment_gateways"("tenantId", "provider", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_notification_settings_tenantId_event_channel_key" ON "tenant_notification_settings"("tenantId", "event", "channel");

-- CreateIndex
CREATE INDEX "users_tenantId_status_idx" ON "users"("tenantId", "status");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_key_key" ON "roles"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "user_roles_tenantId_roleId_idx" ON "user_roles"("tenantId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "academic_years_tenantId_isCurrent_idx" ON "academic_years"("tenantId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_tenantId_name_key" ON "academic_years"("tenantId", "name");

-- CreateIndex
CREATE INDEX "academic_units_tenantId_unitType_active_idx" ON "academic_units"("tenantId", "unitType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "academic_units_tenantId_unitType_code_key" ON "academic_units"("tenantId", "unitType", "code");

-- CreateIndex
CREATE INDEX "students_tenantId_status_idx" ON "students"("tenantId", "status");

-- CreateIndex
CREATE INDEX "students_tenantId_primaryUnitId_idx" ON "students"("tenantId", "primaryUnitId");

-- CreateIndex
CREATE INDEX "students_tenantId_familyGroupId_idx" ON "students"("tenantId", "familyGroupId");

-- CreateIndex
CREATE INDEX "students_tenantId_phone_idx" ON "students"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "students_tenantId_email_idx" ON "students"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenantId_admissionNumber_key" ON "students"("tenantId", "admissionNumber");

-- CreateIndex
CREATE INDEX "student_unit_memberships_tenantId_academicUnitId_idx" ON "student_unit_memberships"("tenantId", "academicUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "student_unit_memberships_studentId_academicUnitId_academicY_key" ON "student_unit_memberships"("studentId", "academicUnitId", "academicYearId");

-- CreateIndex
CREATE INDEX "guardians_tenantId_phone_idx" ON "guardians"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardians_studentId_guardianId_key" ON "student_guardians"("studentId", "guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "student_groups_tenantId_code_key" ON "student_groups"("tenantId", "code");

-- CreateIndex
CREATE INDEX "student_group_members_tenantId_studentId_idx" ON "student_group_members"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_group_members_groupId_studentId_key" ON "student_group_members"("groupId", "studentId");

-- CreateIndex
CREATE INDEX "student_custom_attributes_tenantId_key_idx" ON "student_custom_attributes"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "student_custom_attributes_studentId_key_key" ON "student_custom_attributes"("studentId", "key");

-- CreateIndex
CREATE INDEX "admission_applications_tenantId_status_idx" ON "admission_applications"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_tenantId_applicationNumber_key" ON "admission_applications"("tenantId", "applicationNumber");

-- CreateIndex
CREATE INDEX "admissions_tenantId_status_idx" ON "admissions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admissions_tenantId_admissionNumber_key" ON "admissions"("tenantId", "admissionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sponsors_tenantId_code_key" ON "sponsors"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_categories_tenantId_code_key" ON "fee_categories"("tenantId", "code");

-- CreateIndex
CREATE INDEX "fee_types_tenantId_active_idx" ON "fee_types"("tenantId", "active");

-- CreateIndex
CREATE INDEX "fee_types_tenantId_categoryId_idx" ON "fee_types"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_types_tenantId_code_key" ON "fee_types"("tenantId", "code");

-- CreateIndex
CREATE INDEX "fee_type_versions_tenantId_status_idx" ON "fee_type_versions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_type_versions_feeTypeId_version_key" ON "fee_type_versions"("feeTypeId", "version");

-- CreateIndex
CREATE INDEX "fee_structures_tenantId_active_idx" ON "fee_structures"("tenantId", "active");

-- CreateIndex
CREATE INDEX "fee_structures_tenantId_targetUnitId_idx" ON "fee_structures"("tenantId", "targetUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_tenantId_code_key" ON "fee_structures"("tenantId", "code");

-- CreateIndex
CREATE INDEX "fee_structure_versions_tenantId_status_idx" ON "fee_structure_versions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_versions_feeStructureId_version_key" ON "fee_structure_versions"("feeStructureId", "version");

-- CreateIndex
CREATE INDEX "fee_structure_items_tenantId_feeTypeId_idx" ON "fee_structure_items"("tenantId", "feeTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_items_feeStructureVersionId_feeTypeId_key" ON "fee_structure_items"("feeStructureVersionId", "feeTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "installment_rule_items_feeStructureItemId_sequence_key" ON "installment_rule_items"("feeStructureItemId", "sequence");

-- CreateIndex
CREATE INDEX "fee_policies_tenantId_active_stage_idx" ON "fee_policies"("tenantId", "active", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "fee_policies_tenantId_code_key" ON "fee_policies"("tenantId", "code");

-- CreateIndex
CREATE INDEX "fee_policy_versions_tenantId_status_idx" ON "fee_policy_versions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fee_policy_versions_policyId_version_key" ON "fee_policy_versions"("policyId", "version");

-- CreateIndex
CREATE INDEX "fee_policy_conditions_policyVersionId_groupIndex_idx" ON "fee_policy_conditions"("policyVersionId", "groupIndex");

-- CreateIndex
CREATE INDEX "fee_policy_actions_policyVersionId_idx" ON "fee_policy_actions"("policyVersionId");

-- CreateIndex
CREATE INDEX "fee_policy_scopes_policyVersionId_idx" ON "fee_policy_scopes"("policyVersionId");

-- CreateIndex
CREATE INDEX "fee_policy_scopes_tenantId_targetType_targetId_idx" ON "fee_policy_scopes"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "scholarships_tenantId_active_idx" ON "scholarships"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "scholarships_tenantId_code_key" ON "scholarships"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_tenantId_code_key" ON "discounts"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "concessions_tenantId_code_key" ON "concessions"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "waivers_tenantId_code_key" ON "waivers"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "surcharges_tenantId_code_key" ON "surcharges"("tenantId", "code");

-- CreateIndex
CREATE INDEX "fee_overrides_tenantId_studentId_status_idx" ON "fee_overrides"("tenantId", "studentId", "status");

-- CreateIndex
CREATE INDEX "fee_overrides_tenantId_feeTypeId_idx" ON "fee_overrides"("tenantId", "feeTypeId");

-- CreateIndex
CREATE INDEX "benefit_assignments_tenantId_studentId_status_idx" ON "benefit_assignments"("tenantId", "studentId", "status");

-- CreateIndex
CREATE INDEX "benefit_assignments_tenantId_groupId_idx" ON "benefit_assignments"("tenantId", "groupId");

-- CreateIndex
CREATE INDEX "fee_assignments_tenantId_status_idx" ON "fee_assignments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "fee_assignments_tenantId_targetType_targetId_idx" ON "fee_assignments"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "fee_demands_tenantId_studentId_status_idx" ON "fee_demands"("tenantId", "studentId", "status");

-- CreateIndex
CREATE INDEX "fee_demands_tenantId_dueDate_idx" ON "fee_demands"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "fee_demands_tenantId_academicYearId_idx" ON "fee_demands"("tenantId", "academicYearId");

-- CreateIndex
CREATE INDEX "fee_demands_tenantId_status_dueDate_idx" ON "fee_demands"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "fee_demands_tenantId_feeAssignmentId_idx" ON "fee_demands"("tenantId", "feeAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_demands_tenantId_demandNumber_key" ON "fee_demands"("tenantId", "demandNumber");

-- CreateIndex
CREATE INDEX "fee_demand_items_tenantId_demandId_idx" ON "fee_demand_items"("tenantId", "demandId");

-- CreateIndex
CREATE INDEX "fee_demand_items_tenantId_feeTypeId_idx" ON "fee_demand_items"("tenantId", "feeTypeId");

-- CreateIndex
CREATE INDEX "fee_demand_items_tenantId_status_idx" ON "fee_demand_items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "fee_demand_item_adjustments_tenantId_demandItemId_idx" ON "fee_demand_item_adjustments"("tenantId", "demandItemId");

-- CreateIndex
CREATE INDEX "fee_demand_item_adjustments_tenantId_code_idx" ON "fee_demand_item_adjustments"("tenantId", "code");

-- CreateIndex
CREATE INDEX "fee_demand_item_adjustments_tenantId_policyId_idx" ON "fee_demand_item_adjustments"("tenantId", "policyId");

-- CreateIndex
CREATE INDEX "late_fee_accruals_tenantId_demandId_idx" ON "late_fee_accruals"("tenantId", "demandId");

-- CreateIndex
CREATE INDEX "late_fee_accruals_tenantId_calculatedFor_idx" ON "late_fee_accruals"("tenantId", "calculatedFor");

-- CreateIndex
CREATE INDEX "installments_tenantId_status_dueDate_idx" ON "installments"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "installments_demandId_sequence_key" ON "installments"("demandId", "sequence");

-- CreateIndex
CREATE INDEX "installment_items_tenantId_installmentId_idx" ON "installment_items"("tenantId", "installmentId");

-- CreateIndex
CREATE INDEX "payment_orders_tenantId_status_idx" ON "payment_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "payment_orders_tenantId_studentId_idx" ON "payment_orders"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_tenantId_orderNumber_key" ON "payment_orders"("tenantId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_tenantId_idempotencyKey_key" ON "payment_orders"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_tenantId_studentId_status_idx" ON "payments"("tenantId", "studentId", "status");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_paidAt_idx" ON "payments"("tenantId", "status", "paidAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_paidAt_idx" ON "payments"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_provider_providerTxnId_idx" ON "payments"("tenantId", "provider", "providerTxnId");

-- CreateIndex
CREATE INDEX "payments_tenantId_referenceNumber_idx" ON "payments"("tenantId", "referenceNumber");

-- CreateIndex
CREATE INDEX "payments_tenantId_channel_idx" ON "payments"("tenantId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_paymentNumber_key" ON "payments"("tenantId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_receiptNumber_key" ON "payments"("tenantId", "receiptNumber");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_paymentId_idx" ON "payment_allocations"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_demandItemId_idx" ON "payment_allocations"("tenantId", "demandItemId");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_demandId_idx" ON "payment_allocations"("tenantId", "demandId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_tenantId_code_key" ON "payment_methods"("tenantId", "code");

-- CreateIndex
CREATE INDEX "gateway_transactions_tenantId_status_idx" ON "gateway_transactions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "gateway_transactions_tenantId_paymentOrderId_idx" ON "gateway_transactions"("tenantId", "paymentOrderId");

-- CreateIndex
CREATE INDEX "gateway_transactions_tenantId_settlementId_idx" ON "gateway_transactions"("tenantId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_txn_tenant_provider_env_order_key" ON "gateway_transactions"("tenantId", "provider", "environment", "providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_txn_tenant_provider_env_txn_key" ON "gateway_transactions"("tenantId", "provider", "environment", "providerTxnId");

-- CreateIndex
CREATE INDEX "gateway_webhooks_tenantId_processingStatus_idx" ON "gateway_webhooks"("tenantId", "processingStatus");

-- CreateIndex
CREATE INDEX "gateway_webhooks_tenantId_receivedAt_idx" ON "gateway_webhooks"("tenantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_webhook_tenant_provider_event_key" ON "gateway_webhooks"("tenantId", "provider", "externalEventId");

-- CreateIndex
CREATE INDEX "idempotency_keys_tenantId_expiresAt_idx" ON "idempotency_keys"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenantId_scope_key_key" ON "idempotency_keys"("tenantId", "scope", "key");

-- CreateIndex
CREATE INDEX "refunds_tenantId_paymentId_idx" ON "refunds"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "refunds_tenantId_status_idx" ON "refunds"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_tenantId_refundNumber_key" ON "refunds"("tenantId", "refundNumber");

-- CreateIndex
CREATE INDEX "credits_tenantId_studentId_status_idx" ON "credits"("tenantId", "studentId", "status");

-- CreateIndex
CREATE INDEX "credits_tenantId_source_idx" ON "credits"("tenantId", "source");

-- CreateIndex
CREATE INDEX "credit_allocations_tenantId_creditId_idx" ON "credit_allocations"("tenantId", "creditId");

-- CreateIndex
CREATE INDEX "credit_allocations_tenantId_demandItemId_idx" ON "credit_allocations"("tenantId", "demandItemId");

-- CreateIndex
CREATE INDEX "adjustments_tenantId_demandId_idx" ON "adjustments"("tenantId", "demandId");

-- CreateIndex
CREATE INDEX "adjustments_tenantId_status_idx" ON "adjustments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "adjustments_tenantId_kind_idx" ON "adjustments"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "adjustments_tenantId_adjustmentNumber_key" ON "adjustments"("tenantId", "adjustmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_tenantId_code_key" ON "ledger_accounts"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_tenantId_systemKey_key" ON "ledger_accounts"("tenantId", "systemKey");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_transactionGroupId_idx" ON "ledger_entries"("tenantId", "transactionGroupId");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_accountId_entryDate_idx" ON "ledger_entries"("tenantId", "accountId", "entryDate");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_studentId_entryDate_idx" ON "ledger_entries"("tenantId", "studentId", "entryDate");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_eventType_idx" ON "ledger_entries"("tenantId", "eventType");

-- CreateIndex
CREATE INDEX "ledger_entries_tenantId_paymentId_idx" ON "ledger_entries"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "receipts_tenantId_studentId_idx" ON "receipts"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "receipts_tenantId_issueDate_idx" ON "receipts"("tenantId", "issueDate");

-- CreateIndex
CREATE INDEX "receipts_tenantId_status_idx" ON "receipts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenantId_receiptNumber_key" ON "receipts"("tenantId", "receiptNumber");

-- CreateIndex
CREATE INDEX "receipt_lines_tenantId_receiptId_idx" ON "receipt_lines"("tenantId", "receiptId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_studentId_idx" ON "invoices"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_invoiceNumber_key" ON "invoices"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "invoice_lines_tenantId_invoiceId_idx" ON "invoice_lines"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "documents_tenantId_kind_idx" ON "documents"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenantId_bucket_objectKey_key" ON "documents"("tenantId", "bucket", "objectKey");

-- CreateIndex
CREATE INDEX "settlements_tenantId_settlementDate_idx" ON "settlements"("tenantId", "settlementDate");

-- CreateIndex
CREATE INDEX "settlements_tenantId_status_idx" ON "settlements"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_tenant_provider_env_ref_key" ON "settlements"("tenantId", "provider", "environment", "settlementReference");

-- CreateIndex
CREATE INDEX "reconciliation_records_tenantId_status_idx" ON "reconciliation_records"("tenantId", "status");

-- CreateIndex
CREATE INDEX "reconciliation_records_tenantId_settlementId_idx" ON "reconciliation_records"("tenantId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_tenantId_event_channel_locale_key" ON "notification_templates"("tenantId", "event", "channel", "locale");

-- CreateIndex
CREATE INDEX "notifications_tenantId_status_scheduledFor_idx" ON "notifications"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "notifications_tenantId_event_idx" ON "notifications"("tenantId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_dedupeKey_key" ON "notifications"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_actorId_idx" ON "audit_logs"("tenantId", "actorId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_status_idx" ON "approval_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_actionType_status_idx" ON "approval_requests"("tenantId", "actionType", "status");

-- CreateIndex
CREATE INDEX "report_jobs_tenantId_status_idx" ON "report_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "report_jobs_tenantId_reportKey_idx" ON "report_jobs"("tenantId", "reportKey");

-- CreateIndex
CREATE INDEX "export_jobs_tenantId_status_idx" ON "export_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_status_availableAt_idx" ON "outbox_events"("tenantId", "status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenantId_dedupeKey_key" ON "outbox_events"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_tenantId_kind_scope_key" ON "sequences"("tenantId", "kind", "scope");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_numbering_settings" ADD CONSTRAINT "tenant_numbering_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_payment_gateways" ADD CONSTRAINT "tenant_payment_gateways_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notification_settings" ADD CONSTRAINT "tenant_notification_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_unit_memberships" ADD CONSTRAINT "student_unit_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_unit_memberships" ADD CONSTRAINT "student_unit_memberships_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_unit_memberships" ADD CONSTRAINT "student_unit_memberships_academicUnitId_fkey" FOREIGN KEY ("academicUnitId") REFERENCES "academic_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_custom_attributes" ADD CONSTRAINT "student_custom_attributes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_custom_attributes" ADD CONSTRAINT "student_custom_attributes_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "admission_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_categories" ADD CONSTRAINT "fee_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "fee_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_type_versions" ADD CONSTRAINT "fee_type_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_type_versions" ADD CONSTRAINT "fee_type_versions_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "fee_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_versions" ADD CONSTRAINT "fee_structure_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_versions" ADD CONSTRAINT "fee_structure_versions_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_feeStructureVersionId_fkey" FOREIGN KEY ("feeStructureVersionId") REFERENCES "fee_structure_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "fee_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_rule_items" ADD CONSTRAINT "installment_rule_items_feeStructureItemId_fkey" FOREIGN KEY ("feeStructureItemId") REFERENCES "fee_structure_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policies" ADD CONSTRAINT "fee_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_versions" ADD CONSTRAINT "fee_policy_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_versions" ADD CONSTRAINT "fee_policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "fee_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_conditions" ADD CONSTRAINT "fee_policy_conditions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_conditions" ADD CONSTRAINT "fee_policy_conditions_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "fee_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_actions" ADD CONSTRAINT "fee_policy_actions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_actions" ADD CONSTRAINT "fee_policy_actions_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "fee_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_scopes" ADD CONSTRAINT "fee_policy_scopes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_policy_scopes" ADD CONSTRAINT "fee_policy_scopes_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "fee_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarships" ADD CONSTRAINT "scholarships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concessions" ADD CONSTRAINT "concessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surcharges" ADD CONSTRAINT "surcharges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_overrides" ADD CONSTRAINT "fee_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_overrides" ADD CONSTRAINT "fee_overrides_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_scholarshipId_fkey" FOREIGN KEY ("scholarshipId") REFERENCES "scholarships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_concessionId_fkey" FOREIGN KEY ("concessionId") REFERENCES "concessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_waiverId_fkey" FOREIGN KEY ("waiverId") REFERENCES "waivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_feeStructureVersionId_fkey" FOREIGN KEY ("feeStructureVersionId") REFERENCES "fee_structure_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_feeAssignmentId_fkey" FOREIGN KEY ("feeAssignmentId") REFERENCES "fee_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demand_items" ADD CONSTRAINT "fee_demand_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demand_items" ADD CONSTRAINT "fee_demand_items_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "fee_demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demand_item_adjustments" ADD CONSTRAINT "fee_demand_item_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demand_item_adjustments" ADD CONSTRAINT "fee_demand_item_adjustments_demandItemId_fkey" FOREIGN KEY ("demandItemId") REFERENCES "fee_demand_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_accruals" ADD CONSTRAINT "late_fee_accruals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_accruals" ADD CONSTRAINT "late_fee_accruals_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "fee_demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "fee_demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_items" ADD CONSTRAINT "installment_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_items" ADD CONSTRAINT "installment_items_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "installments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_demandItemId_fkey" FOREIGN KEY ("demandItemId") REFERENCES "fee_demand_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_webhooks" ADD CONSTRAINT "gateway_webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_demandItemId_fkey" FOREIGN KEY ("demandItemId") REFERENCES "fee_demand_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "fee_demands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

