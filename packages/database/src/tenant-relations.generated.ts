/** Generated from prisma/schema.prisma and the explicit reference manifest. Do not edit manually. */
export type TenantReferenceTarget = { model: string; field: string };
export type TenantReferenceRule = readonly TenantReferenceTarget[] | { discriminator: string; defaultValue?: string; values: Readonly<Record<string, readonly TenantReferenceTarget[]>> };
export const TENANT_FOREIGN_KEY_TARGETS: Readonly<Record<string, Readonly<Record<string, TenantReferenceRule>>>> = {
  "AcademicUnit": {
    "parentId": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ]
  },
  "Adjustment": {
    "approvalRequestId": [
      {
        "model": "ApprovalRequest",
        "field": "id"
      }
    ],
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "creditId": [
      {
        "model": "Credit",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "installmentItemId": [
      {
        "model": "InstallmentItem",
        "field": "id"
      }
    ],
    "instrumentId": {
      "discriminator": "instrumentType",
      "values": {
        "CONCESSION": [
          {
            "model": "Concession",
            "field": "id"
          }
        ],
        "DISCOUNT": [
          {
            "model": "Discount",
            "field": "id"
          }
        ],
        "OVERRIDE": [
          {
            "model": "FeeOverride",
            "field": "id"
          }
        ],
        "LATE_FEE": [
          {
            "model": "LateFeeAccrual",
            "field": "id"
          }
        ],
        "SCHOLARSHIP": [
          {
            "model": "Scholarship",
            "field": "id"
          }
        ],
        "SURCHARGE": [
          {
            "model": "Surcharge",
            "field": "id"
          }
        ],
        "WAIVER": [
          {
            "model": "Waiver",
            "field": "id"
          }
        ]
      }
    },
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ],
    "requestedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "reversalOfAdjustmentId": [
      {
        "model": "Adjustment",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "Admission": {
    "applicationId": [
      {
        "model": "AdmissionApplication",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "AdmissionApplication": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "targetUnitId": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ]
  },
  "ApprovalRequest": {
    "decidedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "entityId": {
      "discriminator": "entityType",
      "values": {
        "TenantSettings": [
          {
            "model": "TenantSettings",
            "field": "id"
          }
        ],
        "TenantBranding": [
          {
            "model": "TenantBranding",
            "field": "id"
          }
        ],
        "TenantDomain": [
          {
            "model": "TenantDomain",
            "field": "id"
          }
        ],
        "Branch": [
          {
            "model": "Branch",
            "field": "id"
          }
        ],
        "UserBranchMembership": [
          {
            "model": "UserBranchMembership",
            "field": "id"
          }
        ],
        "OrganizationUnit": [
          {
            "model": "OrganizationUnit",
            "field": "id"
          }
        ],
        "UserOrganizationMembership": [
          {
            "model": "UserOrganizationMembership",
            "field": "id"
          }
        ],
        "UserAssignment": [
          {
            "model": "UserAssignment",
            "field": "id"
          }
        ],
        "TenantSubscription": [
          {
            "model": "TenantSubscription",
            "field": "id"
          }
        ],
        "TenantModuleOverride": [
          {
            "model": "TenantModuleOverride",
            "field": "id"
          }
        ],
        "TenantEntitlementOverride": [
          {
            "model": "TenantEntitlementOverride",
            "field": "id"
          }
        ],
        "PlatformInvoice": [
          {
            "model": "PlatformInvoice",
            "field": "id"
          }
        ],
        "PlatformPayment": [
          {
            "model": "PlatformPayment",
            "field": "id"
          }
        ],
        "PlatformRefund": [
          {
            "model": "PlatformRefund",
            "field": "id"
          }
        ],
        "TenantNumberingSettings": [
          {
            "model": "TenantNumberingSettings",
            "field": "id"
          }
        ],
        "TenantPaymentGateway": [
          {
            "model": "TenantPaymentGateway",
            "field": "id"
          }
        ],
        "TenantNotificationSetting": [
          {
            "model": "TenantNotificationSetting",
            "field": "id"
          }
        ],
        "User": [
          {
            "model": "User",
            "field": "id"
          }
        ],
        "Role": [
          {
            "model": "Role",
            "field": "id"
          }
        ],
        "UserRole": [
          {
            "model": "UserRole",
            "field": "id"
          }
        ],
        "RolePermission": [
          {
            "model": "RolePermission",
            "field": "id"
          }
        ],
        "RefreshToken": [
          {
            "model": "RefreshToken",
            "field": "id"
          }
        ],
        "AcademicYear": [
          {
            "model": "AcademicYear",
            "field": "id"
          }
        ],
        "AcademicUnit": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "Student": [
          {
            "model": "Student",
            "field": "id"
          }
        ],
        "TenantPerson": [
          {
            "model": "TenantPerson",
            "field": "id"
          }
        ],
        "TenantPersonGroup": [
          {
            "model": "TenantPersonGroup",
            "field": "id"
          }
        ],
        "TenantPersonGroupMember": [
          {
            "model": "TenantPersonGroupMember",
            "field": "id"
          }
        ],
        "StudentUnitMembership": [
          {
            "model": "StudentUnitMembership",
            "field": "id"
          }
        ],
        "Guardian": [
          {
            "model": "Guardian",
            "field": "id"
          }
        ],
        "StudentGuardian": [
          {
            "model": "StudentGuardian",
            "field": "id"
          }
        ],
        "AttendanceSession": [
          {
            "model": "AttendanceSession",
            "field": "id"
          }
        ],
        "AttendanceRecord": [
          {
            "model": "AttendanceRecord",
            "field": "id"
          }
        ],
        "StudentGroup": [
          {
            "model": "StudentGroup",
            "field": "id"
          }
        ],
        "StudentGroupMember": [
          {
            "model": "StudentGroupMember",
            "field": "id"
          }
        ],
        "StudentCustomAttribute": [
          {
            "model": "StudentCustomAttribute",
            "field": "id"
          }
        ],
        "AdmissionApplication": [
          {
            "model": "AdmissionApplication",
            "field": "id"
          }
        ],
        "Admission": [
          {
            "model": "Admission",
            "field": "id"
          }
        ],
        "Sponsor": [
          {
            "model": "Sponsor",
            "field": "id"
          }
        ],
        "PayerResponsibilityRule": [
          {
            "model": "PayerResponsibilityRule",
            "field": "id"
          }
        ],
        "FeeCategory": [
          {
            "model": "FeeCategory",
            "field": "id"
          }
        ],
        "FeeType": [
          {
            "model": "FeeType",
            "field": "id"
          }
        ],
        "FeeTypeVersion": [
          {
            "model": "FeeTypeVersion",
            "field": "id"
          }
        ],
        "FeeStructure": [
          {
            "model": "FeeStructure",
            "field": "id"
          }
        ],
        "FeeStructureVersion": [
          {
            "model": "FeeStructureVersion",
            "field": "id"
          }
        ],
        "FeeStructureItem": [
          {
            "model": "FeeStructureItem",
            "field": "id"
          }
        ],
        "InstallmentRuleItem": [
          {
            "model": "InstallmentRuleItem",
            "field": "id"
          }
        ],
        "FeePolicy": [
          {
            "model": "FeePolicy",
            "field": "id"
          }
        ],
        "FeePolicyVersion": [
          {
            "model": "FeePolicyVersion",
            "field": "id"
          }
        ],
        "FeePolicyCondition": [
          {
            "model": "FeePolicyCondition",
            "field": "id"
          }
        ],
        "FeePolicyAction": [
          {
            "model": "FeePolicyAction",
            "field": "id"
          }
        ],
        "FeePolicyScope": [
          {
            "model": "FeePolicyScope",
            "field": "id"
          }
        ],
        "Scholarship": [
          {
            "model": "Scholarship",
            "field": "id"
          }
        ],
        "Discount": [
          {
            "model": "Discount",
            "field": "id"
          }
        ],
        "Concession": [
          {
            "model": "Concession",
            "field": "id"
          }
        ],
        "Waiver": [
          {
            "model": "Waiver",
            "field": "id"
          }
        ],
        "Surcharge": [
          {
            "model": "Surcharge",
            "field": "id"
          }
        ],
        "FeeOverride": [
          {
            "model": "FeeOverride",
            "field": "id"
          }
        ],
        "BenefitAssignment": [
          {
            "model": "BenefitAssignment",
            "field": "id"
          }
        ],
        "FeeAssignment": [
          {
            "model": "FeeAssignment",
            "field": "id"
          }
        ],
        "FeeAssignmentCycle": [
          {
            "model": "FeeAssignmentCycle",
            "field": "id"
          }
        ],
        "FeeUsageInput": [
          {
            "model": "FeeUsageInput",
            "field": "id"
          }
        ],
        "FeeDemand": [
          {
            "model": "FeeDemand",
            "field": "id"
          }
        ],
        "FeeDemandItem": [
          {
            "model": "FeeDemandItem",
            "field": "id"
          }
        ],
        "FeeDemandResponsibility": [
          {
            "model": "FeeDemandResponsibility",
            "field": "id"
          }
        ],
        "FeeDemandItemAdjustment": [
          {
            "model": "FeeDemandItemAdjustment",
            "field": "id"
          }
        ],
        "LateFeeAccrual": [
          {
            "model": "LateFeeAccrual",
            "field": "id"
          }
        ],
        "Installment": [
          {
            "model": "Installment",
            "field": "id"
          }
        ],
        "InstallmentItem": [
          {
            "model": "InstallmentItem",
            "field": "id"
          }
        ],
        "PaymentOrder": [
          {
            "model": "PaymentOrder",
            "field": "id"
          }
        ],
        "Payment": [
          {
            "model": "Payment",
            "field": "id"
          }
        ],
        "PaymentAllocation": [
          {
            "model": "PaymentAllocation",
            "field": "id"
          }
        ],
        "PaymentMethod": [
          {
            "model": "PaymentMethod",
            "field": "id"
          }
        ],
        "GatewayTransaction": [
          {
            "model": "GatewayTransaction",
            "field": "id"
          }
        ],
        "GatewayWebhook": [
          {
            "model": "GatewayWebhook",
            "field": "id"
          }
        ],
        "IdempotencyKey": [
          {
            "model": "IdempotencyKey",
            "field": "id"
          }
        ],
        "Refund": [
          {
            "model": "Refund",
            "field": "id"
          }
        ],
        "RefundAllocation": [
          {
            "model": "RefundAllocation",
            "field": "id"
          }
        ],
        "Credit": [
          {
            "model": "Credit",
            "field": "id"
          }
        ],
        "CreditAllocation": [
          {
            "model": "CreditAllocation",
            "field": "id"
          }
        ],
        "Adjustment": [
          {
            "model": "Adjustment",
            "field": "id"
          }
        ],
        "LedgerAccount": [
          {
            "model": "LedgerAccount",
            "field": "id"
          }
        ],
        "LedgerEntry": [
          {
            "model": "LedgerEntry",
            "field": "id"
          }
        ],
        "Receipt": [
          {
            "model": "Receipt",
            "field": "id"
          }
        ],
        "ReceiptLine": [
          {
            "model": "ReceiptLine",
            "field": "id"
          }
        ],
        "Invoice": [
          {
            "model": "Invoice",
            "field": "id"
          }
        ],
        "InvoiceLine": [
          {
            "model": "InvoiceLine",
            "field": "id"
          }
        ],
        "Document": [
          {
            "model": "Document",
            "field": "id"
          }
        ],
        "Settlement": [
          {
            "model": "Settlement",
            "field": "id"
          }
        ],
        "ReconciliationRecord": [
          {
            "model": "ReconciliationRecord",
            "field": "id"
          }
        ],
        "NotificationTemplate": [
          {
            "model": "NotificationTemplate",
            "field": "id"
          }
        ],
        "Notification": [
          {
            "model": "Notification",
            "field": "id"
          }
        ],
        "AuditLog": [
          {
            "model": "AuditLog",
            "field": "id"
          }
        ],
        "AuditChainHead": [
          {
            "model": "AuditChainHead",
            "field": "id"
          }
        ],
        "AuditRequestNonce": [
          {
            "model": "AuditRequestNonce",
            "field": "id"
          }
        ],
        "ApprovalRequest": [
          {
            "model": "ApprovalRequest",
            "field": "id"
          }
        ],
        "ReportJob": [
          {
            "model": "ReportJob",
            "field": "id"
          }
        ],
        "ExportJob": [
          {
            "model": "ExportJob",
            "field": "id"
          }
        ],
        "OutboxEvent": [
          {
            "model": "OutboxEvent",
            "field": "id"
          }
        ],
        "Sequence": [
          {
            "model": "Sequence",
            "field": "id"
          }
        ]
      }
    },
    "requestedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "AttendanceRecord": {
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "sessionId": [
      {
        "model": "AttendanceSession",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "AttendanceSession": {
    "academicUnitId": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "markedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "personGroupId": [
      {
        "model": "TenantPersonGroup",
        "field": "id"
      }
    ]
  },
  "AuditLog": {
    "actorId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "BenefitAssignment": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "concessionId": [
      {
        "model": "Concession",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "discountId": [
      {
        "model": "Discount",
        "field": "id"
      }
    ],
    "groupId": [
      {
        "model": "StudentGroup",
        "field": "id"
      }
    ],
    "scholarshipId": [
      {
        "model": "Scholarship",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "waiverId": [
      {
        "model": "Waiver",
        "field": "id"
      }
    ]
  },
  "Branch": {
    "managerId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "Concession": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeIds": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ]
  },
  "Credit": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "refundId": [
      {
        "model": "Refund",
        "field": "id"
      }
    ],
    "sourceDemandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "sponsorId": [
      {
        "model": "Sponsor",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "CreditAllocation": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "creditId": [
      {
        "model": "Credit",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "installmentId": [
      {
        "model": "Installment",
        "field": "id"
      }
    ],
    "responsibilityId": [
      {
        "model": "FeeDemandResponsibility",
        "field": "id"
      }
    ]
  },
  "Discount": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeIds": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ]
  },
  "Document": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "receiptId": [
      {
        "model": "Receipt",
        "field": "id"
      }
    ],
    "reportJobId": [
      {
        "model": "ReportJob",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "ExportJob": {
    "requestedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "resultDocumentId": [
      {
        "model": "Document",
        "field": "id"
      }
    ]
  },
  "FeeAssignment": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeStructureId": [
      {
        "model": "FeeStructure",
        "field": "id"
      }
    ],
    "feeStructureVersionId": [
      {
        "model": "FeeStructureVersion",
        "field": "id"
      }
    ],
    "targetId": {
      "discriminator": "targetType",
      "values": {
        "STUDENT": [
          {
            "model": "Student",
            "field": "id"
          }
        ],
        "CLASS": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "SECTION": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "BATCH": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "COURSE": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "DEPARTMENT": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "PROGRAM": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "HOSTEL": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "TRANSPORT_ROUTE": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "CUSTOM_GROUP": [
          {
            "model": "StudentGroup",
            "field": "id"
          }
        ]
      }
    },
    "targetPersonIds": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "targetStudentIds": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "FeeAssignmentCycle": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeAssignmentId": [
      {
        "model": "FeeAssignment",
        "field": "id"
      }
    ]
  },
  "FeeDemand": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "cycleId": [
      {
        "model": "FeeAssignmentCycle",
        "field": "id"
      }
    ],
    "feeAssignmentId": [
      {
        "model": "FeeAssignment",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "FeeDemandItem": {
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "feeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "feeTypeVersionId": [
      {
        "model": "FeeTypeVersion",
        "field": "id"
      }
    ]
  },
  "FeeDemandItemAdjustment": {
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "instrumentId": {
      "discriminator": "instrumentType",
      "values": {
        "CONCESSION": [
          {
            "model": "Concession",
            "field": "id"
          }
        ],
        "DISCOUNT": [
          {
            "model": "Discount",
            "field": "id"
          }
        ],
        "OVERRIDE": [
          {
            "model": "FeeOverride",
            "field": "id"
          }
        ],
        "LATE_FEE": [
          {
            "model": "LateFeeAccrual",
            "field": "id"
          }
        ],
        "SCHOLARSHIP": [
          {
            "model": "Scholarship",
            "field": "id"
          }
        ],
        "SURCHARGE": [
          {
            "model": "Surcharge",
            "field": "id"
          }
        ],
        "WAIVER": [
          {
            "model": "Waiver",
            "field": "id"
          }
        ]
      }
    },
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ],
    "policyVersionId": [
      {
        "model": "FeePolicyVersion",
        "field": "id"
      }
    ]
  },
  "FeeDemandResponsibility": {
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "payerGuardianId": [
      {
        "model": "Guardian",
        "field": "id"
      }
    ],
    "payerSponsorId": [
      {
        "model": "Sponsor",
        "field": "id"
      }
    ],
    "sourceRuleId": [
      {
        "model": "PayerResponsibilityRule",
        "field": "id"
      }
    ]
  },
  "FeeOverride": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "FeePolicy": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "FeePolicyAction": {
    "feeTypeIds": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "policyVersionId": [
      {
        "model": "FeePolicyVersion",
        "field": "id"
      }
    ]
  },
  "FeePolicyCondition": {
    "policyVersionId": [
      {
        "model": "FeePolicyVersion",
        "field": "id"
      }
    ]
  },
  "FeePolicyScope": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "policyVersionId": [
      {
        "model": "FeePolicyVersion",
        "field": "id"
      }
    ],
    "targetId": {
      "discriminator": "targetType",
      "values": {
        "STUDENT": [
          {
            "model": "Student",
            "field": "id"
          }
        ],
        "CLASS": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "SECTION": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "BATCH": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "COURSE": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "DEPARTMENT": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "PROGRAM": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "HOSTEL": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "TRANSPORT_ROUTE": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "CUSTOM_GROUP": [
          {
            "model": "StudentGroup",
            "field": "id"
          }
        ]
      }
    }
  },
  "FeePolicyVersion": {
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ]
  },
  "FeeStructure": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "targetUnitId": {
      "discriminator": "targetType",
      "defaultValue": "CLASS",
      "values": {
        "CLASS": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "SECTION": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "BATCH": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "COURSE": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "DEPARTMENT": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "PROGRAM": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "HOSTEL": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "TRANSPORT_ROUTE": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ]
      }
    },
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "FeeStructureItem": {
    "feeStructureVersionId": [
      {
        "model": "FeeStructureVersion",
        "field": "id"
      }
    ],
    "feeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "feeTypeVersionId": [
      {
        "model": "FeeTypeVersion",
        "field": "id"
      }
    ]
  },
  "FeeStructureVersion": {
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeStructureId": [
      {
        "model": "FeeStructure",
        "field": "id"
      }
    ],
    "supersedesVersionId": [
      {
        "model": "FeeStructureVersion",
        "field": "id"
      }
    ]
  },
  "FeeType": {
    "categoryId": [
      {
        "model": "FeeCategory",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "FeeTypeVersion": {
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ]
  },
  "FeeUsageInput": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "cycleId": [
      {
        "model": "FeeAssignmentCycle",
        "field": "id"
      }
    ],
    "feeStructureItemId": [
      {
        "model": "FeeStructureItem",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ]
  },
  "GatewayTransaction": {
    "gatewayConfigId": [
      {
        "model": "TenantPaymentGateway",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "paymentOrderId": [
      {
        "model": "PaymentOrder",
        "field": "id"
      }
    ],
    "settlementId": [
      {
        "model": "Settlement",
        "field": "id"
      }
    ]
  },
  "GatewayWebhook": {
    "resultingPaymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "resultingTransactionId": [
      {
        "model": "GatewayTransaction",
        "field": "id"
      }
    ]
  },
  "IdempotencyKey": {
    "resourceId": {
      "discriminator": "resourceType",
      "values": {
        "TenantSettings": [
          {
            "model": "TenantSettings",
            "field": "id"
          }
        ],
        "TenantBranding": [
          {
            "model": "TenantBranding",
            "field": "id"
          }
        ],
        "TenantDomain": [
          {
            "model": "TenantDomain",
            "field": "id"
          }
        ],
        "Branch": [
          {
            "model": "Branch",
            "field": "id"
          }
        ],
        "UserBranchMembership": [
          {
            "model": "UserBranchMembership",
            "field": "id"
          }
        ],
        "OrganizationUnit": [
          {
            "model": "OrganizationUnit",
            "field": "id"
          }
        ],
        "UserOrganizationMembership": [
          {
            "model": "UserOrganizationMembership",
            "field": "id"
          }
        ],
        "UserAssignment": [
          {
            "model": "UserAssignment",
            "field": "id"
          }
        ],
        "TenantSubscription": [
          {
            "model": "TenantSubscription",
            "field": "id"
          }
        ],
        "TenantModuleOverride": [
          {
            "model": "TenantModuleOverride",
            "field": "id"
          }
        ],
        "TenantEntitlementOverride": [
          {
            "model": "TenantEntitlementOverride",
            "field": "id"
          }
        ],
        "PlatformInvoice": [
          {
            "model": "PlatformInvoice",
            "field": "id"
          }
        ],
        "PlatformPayment": [
          {
            "model": "PlatformPayment",
            "field": "id"
          }
        ],
        "PlatformRefund": [
          {
            "model": "PlatformRefund",
            "field": "id"
          }
        ],
        "TenantNumberingSettings": [
          {
            "model": "TenantNumberingSettings",
            "field": "id"
          }
        ],
        "TenantPaymentGateway": [
          {
            "model": "TenantPaymentGateway",
            "field": "id"
          }
        ],
        "TenantNotificationSetting": [
          {
            "model": "TenantNotificationSetting",
            "field": "id"
          }
        ],
        "User": [
          {
            "model": "User",
            "field": "id"
          }
        ],
        "Role": [
          {
            "model": "Role",
            "field": "id"
          }
        ],
        "UserRole": [
          {
            "model": "UserRole",
            "field": "id"
          }
        ],
        "RolePermission": [
          {
            "model": "RolePermission",
            "field": "id"
          }
        ],
        "RefreshToken": [
          {
            "model": "RefreshToken",
            "field": "id"
          }
        ],
        "AcademicYear": [
          {
            "model": "AcademicYear",
            "field": "id"
          }
        ],
        "AcademicUnit": [
          {
            "model": "AcademicUnit",
            "field": "id"
          }
        ],
        "Student": [
          {
            "model": "Student",
            "field": "id"
          }
        ],
        "TenantPerson": [
          {
            "model": "TenantPerson",
            "field": "id"
          }
        ],
        "TenantPersonGroup": [
          {
            "model": "TenantPersonGroup",
            "field": "id"
          }
        ],
        "TenantPersonGroupMember": [
          {
            "model": "TenantPersonGroupMember",
            "field": "id"
          }
        ],
        "StudentUnitMembership": [
          {
            "model": "StudentUnitMembership",
            "field": "id"
          }
        ],
        "Guardian": [
          {
            "model": "Guardian",
            "field": "id"
          }
        ],
        "StudentGuardian": [
          {
            "model": "StudentGuardian",
            "field": "id"
          }
        ],
        "AttendanceSession": [
          {
            "model": "AttendanceSession",
            "field": "id"
          }
        ],
        "AttendanceRecord": [
          {
            "model": "AttendanceRecord",
            "field": "id"
          }
        ],
        "StudentGroup": [
          {
            "model": "StudentGroup",
            "field": "id"
          }
        ],
        "StudentGroupMember": [
          {
            "model": "StudentGroupMember",
            "field": "id"
          }
        ],
        "StudentCustomAttribute": [
          {
            "model": "StudentCustomAttribute",
            "field": "id"
          }
        ],
        "AdmissionApplication": [
          {
            "model": "AdmissionApplication",
            "field": "id"
          }
        ],
        "Admission": [
          {
            "model": "Admission",
            "field": "id"
          }
        ],
        "Sponsor": [
          {
            "model": "Sponsor",
            "field": "id"
          }
        ],
        "PayerResponsibilityRule": [
          {
            "model": "PayerResponsibilityRule",
            "field": "id"
          }
        ],
        "FeeCategory": [
          {
            "model": "FeeCategory",
            "field": "id"
          }
        ],
        "FeeType": [
          {
            "model": "FeeType",
            "field": "id"
          }
        ],
        "FeeTypeVersion": [
          {
            "model": "FeeTypeVersion",
            "field": "id"
          }
        ],
        "FeeStructure": [
          {
            "model": "FeeStructure",
            "field": "id"
          }
        ],
        "FeeStructureVersion": [
          {
            "model": "FeeStructureVersion",
            "field": "id"
          }
        ],
        "FeeStructureItem": [
          {
            "model": "FeeStructureItem",
            "field": "id"
          }
        ],
        "InstallmentRuleItem": [
          {
            "model": "InstallmentRuleItem",
            "field": "id"
          }
        ],
        "FeePolicy": [
          {
            "model": "FeePolicy",
            "field": "id"
          }
        ],
        "FeePolicyVersion": [
          {
            "model": "FeePolicyVersion",
            "field": "id"
          }
        ],
        "FeePolicyCondition": [
          {
            "model": "FeePolicyCondition",
            "field": "id"
          }
        ],
        "FeePolicyAction": [
          {
            "model": "FeePolicyAction",
            "field": "id"
          }
        ],
        "FeePolicyScope": [
          {
            "model": "FeePolicyScope",
            "field": "id"
          }
        ],
        "Scholarship": [
          {
            "model": "Scholarship",
            "field": "id"
          }
        ],
        "Discount": [
          {
            "model": "Discount",
            "field": "id"
          }
        ],
        "Concession": [
          {
            "model": "Concession",
            "field": "id"
          }
        ],
        "Waiver": [
          {
            "model": "Waiver",
            "field": "id"
          }
        ],
        "Surcharge": [
          {
            "model": "Surcharge",
            "field": "id"
          }
        ],
        "FeeOverride": [
          {
            "model": "FeeOverride",
            "field": "id"
          }
        ],
        "BenefitAssignment": [
          {
            "model": "BenefitAssignment",
            "field": "id"
          }
        ],
        "FeeAssignment": [
          {
            "model": "FeeAssignment",
            "field": "id"
          }
        ],
        "FeeAssignmentCycle": [
          {
            "model": "FeeAssignmentCycle",
            "field": "id"
          }
        ],
        "FeeUsageInput": [
          {
            "model": "FeeUsageInput",
            "field": "id"
          }
        ],
        "FeeDemand": [
          {
            "model": "FeeDemand",
            "field": "id"
          }
        ],
        "FeeDemandItem": [
          {
            "model": "FeeDemandItem",
            "field": "id"
          }
        ],
        "FeeDemandResponsibility": [
          {
            "model": "FeeDemandResponsibility",
            "field": "id"
          }
        ],
        "FeeDemandItemAdjustment": [
          {
            "model": "FeeDemandItemAdjustment",
            "field": "id"
          }
        ],
        "LateFeeAccrual": [
          {
            "model": "LateFeeAccrual",
            "field": "id"
          }
        ],
        "Installment": [
          {
            "model": "Installment",
            "field": "id"
          }
        ],
        "InstallmentItem": [
          {
            "model": "InstallmentItem",
            "field": "id"
          }
        ],
        "PaymentOrder": [
          {
            "model": "PaymentOrder",
            "field": "id"
          }
        ],
        "Payment": [
          {
            "model": "Payment",
            "field": "id"
          }
        ],
        "PaymentAllocation": [
          {
            "model": "PaymentAllocation",
            "field": "id"
          }
        ],
        "PaymentMethod": [
          {
            "model": "PaymentMethod",
            "field": "id"
          }
        ],
        "GatewayTransaction": [
          {
            "model": "GatewayTransaction",
            "field": "id"
          }
        ],
        "GatewayWebhook": [
          {
            "model": "GatewayWebhook",
            "field": "id"
          }
        ],
        "IdempotencyKey": [
          {
            "model": "IdempotencyKey",
            "field": "id"
          }
        ],
        "Refund": [
          {
            "model": "Refund",
            "field": "id"
          }
        ],
        "RefundAllocation": [
          {
            "model": "RefundAllocation",
            "field": "id"
          }
        ],
        "Credit": [
          {
            "model": "Credit",
            "field": "id"
          }
        ],
        "CreditAllocation": [
          {
            "model": "CreditAllocation",
            "field": "id"
          }
        ],
        "Adjustment": [
          {
            "model": "Adjustment",
            "field": "id"
          }
        ],
        "LedgerAccount": [
          {
            "model": "LedgerAccount",
            "field": "id"
          }
        ],
        "LedgerEntry": [
          {
            "model": "LedgerEntry",
            "field": "id"
          }
        ],
        "Receipt": [
          {
            "model": "Receipt",
            "field": "id"
          }
        ],
        "ReceiptLine": [
          {
            "model": "ReceiptLine",
            "field": "id"
          }
        ],
        "Invoice": [
          {
            "model": "Invoice",
            "field": "id"
          }
        ],
        "InvoiceLine": [
          {
            "model": "InvoiceLine",
            "field": "id"
          }
        ],
        "Document": [
          {
            "model": "Document",
            "field": "id"
          }
        ],
        "Settlement": [
          {
            "model": "Settlement",
            "field": "id"
          }
        ],
        "ReconciliationRecord": [
          {
            "model": "ReconciliationRecord",
            "field": "id"
          }
        ],
        "NotificationTemplate": [
          {
            "model": "NotificationTemplate",
            "field": "id"
          }
        ],
        "Notification": [
          {
            "model": "Notification",
            "field": "id"
          }
        ],
        "AuditLog": [
          {
            "model": "AuditLog",
            "field": "id"
          }
        ],
        "AuditChainHead": [
          {
            "model": "AuditChainHead",
            "field": "id"
          }
        ],
        "AuditRequestNonce": [
          {
            "model": "AuditRequestNonce",
            "field": "id"
          }
        ],
        "ApprovalRequest": [
          {
            "model": "ApprovalRequest",
            "field": "id"
          }
        ],
        "ReportJob": [
          {
            "model": "ReportJob",
            "field": "id"
          }
        ],
        "ExportJob": [
          {
            "model": "ExportJob",
            "field": "id"
          }
        ],
        "OutboxEvent": [
          {
            "model": "OutboxEvent",
            "field": "id"
          }
        ],
        "Sequence": [
          {
            "model": "Sequence",
            "field": "id"
          }
        ]
      }
    }
  },
  "Installment": {
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ]
  },
  "InstallmentItem": {
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "feeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "installmentId": [
      {
        "model": "Installment",
        "field": "id"
      }
    ]
  },
  "InstallmentRuleItem": {
    "feeStructureItemId": [
      {
        "model": "FeeStructureItem",
        "field": "id"
      }
    ]
  },
  "Invoice": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "pdfDocumentId": [
      {
        "model": "Document",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "InvoiceLine": {
    "invoiceId": [
      {
        "model": "Invoice",
        "field": "id"
      }
    ]
  },
  "LateFeeAccrual": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "resultDemandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ]
  },
  "LedgerEntry": {
    "accountId": [
      {
        "model": "LedgerAccount",
        "field": "id"
      }
    ],
    "adjustmentId": [
      {
        "model": "Adjustment",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "creditId": [
      {
        "model": "Credit",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "refundId": [
      {
        "model": "Refund",
        "field": "id"
      }
    ],
    "reversedByGroupId": [
      {
        "model": "LedgerEntry",
        "field": "transactionGroupId"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "Notification": {
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "receiptId": [
      {
        "model": "Receipt",
        "field": "id"
      }
    ],
    "recipientId": {
      "discriminator": "recipientType",
      "values": {
        "USER": [
          {
            "model": "User",
            "field": "id"
          }
        ],
        "STUDENT": [
          {
            "model": "Student",
            "field": "id"
          }
        ],
        "GUARDIAN": [
          {
            "model": "Guardian",
            "field": "id"
          }
        ],
        "PARENT": [
          {
            "model": "Guardian",
            "field": "id"
          }
        ],
        "SPONSOR": [
          {
            "model": "Sponsor",
            "field": "id"
          }
        ]
      }
    },
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "OrganizationUnit": {
    "parentId": [
      {
        "model": "OrganizationUnit",
        "field": "id"
      }
    ]
  },
  "PayerResponsibilityRule": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "payerGuardianId": [
      {
        "model": "Guardian",
        "field": "id"
      }
    ],
    "payerSponsorId": [
      {
        "model": "Sponsor",
        "field": "id"
      }
    ],
    "studentGroupId": [
      {
        "model": "StudentGroup",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "Payment": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "collectedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "gatewayConfigId": [
      {
        "model": "TenantPaymentGateway",
        "field": "id"
      }
    ],
    "methodId": [
      {
        "model": "PaymentMethod",
        "field": "id"
      }
    ],
    "payerGuardianId": [
      {
        "model": "Guardian",
        "field": "id"
      }
    ],
    "payerSponsorId": [
      {
        "model": "Sponsor",
        "field": "id"
      }
    ],
    "payerStudentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "paymentOrderId": [
      {
        "model": "PaymentOrder",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "reversalOfPaymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "verifiedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "PaymentAllocation": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "installmentId": [
      {
        "model": "Installment",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "responsibilityId": [
      {
        "model": "FeeDemandResponsibility",
        "field": "id"
      }
    ],
    "reversedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "PaymentMethod": {
    "preferredGatewayConfigId": [
      {
        "model": "TenantPaymentGateway",
        "field": "id"
      }
    ]
  },
  "PaymentOrder": {
    "admissionApplicationId": [
      {
        "model": "AdmissionApplication",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "gatewayConfigId": [
      {
        "model": "TenantPaymentGateway",
        "field": "id"
      }
    ],
    "intendedDemandItemIds": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "methodId": [
      {
        "model": "PaymentMethod",
        "field": "id"
      }
    ],
    "payerGuardianId": [
      {
        "model": "Guardian",
        "field": "id"
      }
    ],
    "payerSponsorId": [
      {
        "model": "Sponsor",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "PlatformInvoice": {
    "subscriptionId": [
      {
        "model": "TenantSubscription",
        "field": "id"
      }
    ]
  },
  "PlatformPayment": {
    "invoiceId": [
      {
        "model": "PlatformInvoice",
        "field": "id"
      }
    ]
  },
  "PlatformRefund": {
    "paymentId": [
      {
        "model": "PlatformPayment",
        "field": "id"
      }
    ]
  },
  "Receipt": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "pdfDocumentId": [
      {
        "model": "Document",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "replacesReceiptId": [
      {
        "model": "Receipt",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "voidedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "ReceiptLine": {
    "receiptId": [
      {
        "model": "Receipt",
        "field": "id"
      }
    ]
  },
  "ReconciliationRecord": {
    "gatewayTransactionId": [
      {
        "model": "GatewayTransaction",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "refundId": [
      {
        "model": "Refund",
        "field": "id"
      }
    ],
    "resolvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "settlementId": [
      {
        "model": "Settlement",
        "field": "id"
      }
    ]
  },
  "RefreshToken": {
    "rotatedFromId": [
      {
        "model": "RefreshToken",
        "field": "id"
      }
    ],
    "userId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "Refund": {
    "approvalRequestId": [
      {
        "model": "ApprovalRequest",
        "field": "id"
      }
    ],
    "approvedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "gatewayTransactionId": [
      {
        "model": "GatewayTransaction",
        "field": "id"
      }
    ],
    "methodId": [
      {
        "model": "PaymentMethod",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "processedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "requestedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "resultingCreditId": [
      {
        "model": "Credit",
        "field": "id"
      }
    ]
  },
  "RefundAllocation": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "creditAllocationId": [
      {
        "model": "CreditAllocation",
        "field": "id"
      }
    ],
    "creditId": [
      {
        "model": "Credit",
        "field": "id"
      }
    ],
    "demandId": [
      {
        "model": "FeeDemand",
        "field": "id"
      }
    ],
    "demandItemId": [
      {
        "model": "FeeDemandItem",
        "field": "id"
      }
    ],
    "paymentAllocationId": [
      {
        "model": "PaymentAllocation",
        "field": "id"
      }
    ],
    "paymentId": [
      {
        "model": "Payment",
        "field": "id"
      }
    ],
    "refundId": [
      {
        "model": "Refund",
        "field": "id"
      }
    ]
  },
  "ReportJob": {
    "requestedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "resultDocumentId": [
      {
        "model": "Document",
        "field": "id"
      }
    ]
  },
  "Role": {
    "scopeUnitIds": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ]
  },
  "RolePermission": {
    "roleId": [
      {
        "model": "Role",
        "field": "id"
      }
    ]
  },
  "Scholarship": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeIds": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "Settlement": {
    "gatewayConfigId": [
      {
        "model": "TenantPaymentGateway",
        "field": "id"
      }
    ],
    "importedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "sourceFileDocumentId": [
      {
        "model": "Document",
        "field": "id"
      }
    ]
  },
  "Student": {
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "primaryUnitId": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ],
    "transportRouteId": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "StudentCustomAttribute": {
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "StudentGroupMember": {
    "addedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "groupId": [
      {
        "model": "StudentGroup",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "StudentGuardian": {
    "guardianId": [
      {
        "model": "Guardian",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "StudentUnitMembership": {
    "academicUnitId": [
      {
        "model": "AcademicUnit",
        "field": "id"
      }
    ],
    "academicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ]
  },
  "Surcharge": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeIds": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ]
  },
  "TenantBranding": {
    "logoDocumentId": [
      {
        "model": "Document",
        "field": "id"
      }
    ]
  },
  "TenantPaymentGateway": {
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "TenantPerson": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "TenantPersonGroupMember": {
    "groupId": [
      {
        "model": "TenantPersonGroup",
        "field": "id"
      }
    ],
    "personId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ]
  },
  "TenantSettings": {
    "defaultAcademicYearId": [
      {
        "model": "AcademicYear",
        "field": "id"
      }
    ],
    "lateFeeFeeTypeId": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "User": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "guardianId": [
      {
        "model": "Guardian",
        "field": "id"
      }
    ],
    "studentId": [
      {
        "model": "Student",
        "field": "id"
      }
    ],
    "tenantPersonId": [
      {
        "model": "TenantPerson",
        "field": "id"
      }
    ],
    "updatedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "UserAssignment": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "userId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "UserBranchMembership": {
    "branchId": [
      {
        "model": "Branch",
        "field": "id"
      }
    ],
    "grantedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "userId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "UserOrganizationMembership": {
    "unitId": [
      {
        "model": "OrganizationUnit",
        "field": "id"
      }
    ],
    "userId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "UserRole": {
    "grantedBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "roleId": [
      {
        "model": "Role",
        "field": "id"
      }
    ],
    "userId": [
      {
        "model": "User",
        "field": "id"
      }
    ]
  },
  "Waiver": {
    "createdBy": [
      {
        "model": "User",
        "field": "id"
      }
    ],
    "feeTypeIds": [
      {
        "model": "FeeType",
        "field": "id"
      }
    ],
    "policyId": [
      {
        "model": "FeePolicy",
        "field": "id"
      }
    ]
  }
};
export const TENANT_OPAQUE_UUID_FIELDS: Readonly<Record<string, string>> = {
  "TenantSubscription.createdBy": "Platform operator reference belongs to the reserved platform tenant rather than the subscribed tenant.",
  "TenantModuleOverride.updatedBy": "Platform operator reference belongs to the reserved platform tenant rather than the overridden tenant.",
  "TenantEntitlementOverride.updatedBy": "Platform operator reference belongs to the reserved platform tenant rather than the limited tenant.",
  "PlatformRefund.createdBy": "Platform operator reference belongs to the reserved platform tenant rather than the billed tenant.",
  "Student.familyGroupId": "Family grouping key; there is no family-group entity, and it is only compared within tenant-scoped Student queries.",
  "LedgerEntry.transactionGroupId": "Posting-group identifier created within one tenant transaction; not an entity row ID.",
  "PaymentOrder.providerStatusCheckLeaseId": "Opaque idempotent token for one in-flight provider status poll; it never identifies a tenant entity.",
  "AuditRequestNonce.requestNonce": "One-time UUID nonce in a signed audit request envelope; it identifies no tenant entity and is claimed in the owner-only replay table.",
  "AuditLog.appendNonce": "Unique idempotency nonce for one audit append; it identifies no tenant entity and is assigned by a verified API request or trusted database trigger."
};
export const TENANT_OPAQUE_NON_UUID_FIELDS: Readonly<Record<string, string>> = {
  "AuditLog.entityId": "Historical entity identifier retained even after the source entity is deleted; it is displayed only with the tenant-scoped audit entry.",
  "OutboxEvent.aggregateId": "Opaque event aggregate identifier; the outbox publisher emits the event payload and does not load a record by this value."
};
