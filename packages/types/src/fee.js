"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_FACT_PREFIX = exports.FEE_RULE_FIELDS = void 0;
exports.conditionsFromFlatRows = conditionsFromFlatRows;
/**
 * The catalogue of condition fields. Exposing this as data (rather than as
 * engine internals) is what lets the configuration UI build a rule with a
 * dropdown instead of asking an administrator to type a field name.
 */
exports.FEE_RULE_FIELDS = [
    { path: 'student.id', label: 'Student', valueType: 'STRING', group: 'Student' },
    { path: 'student.admissionNumber', label: 'Admission number', valueType: 'STRING', group: 'Student' },
    { path: 'student.class', label: 'Class', valueType: 'STRING', group: 'Student' },
    { path: 'student.section', label: 'Section', valueType: 'STRING', group: 'Student' },
    { path: 'student.batch', label: 'Batch', valueType: 'STRING', group: 'Student' },
    { path: 'student.course', label: 'Course / program', valueType: 'STRING', group: 'Student' },
    { path: 'student.department', label: 'Department', valueType: 'STRING', group: 'Student' },
    { path: 'student.category', label: 'Category', valueType: 'STRING', group: 'Student' },
    { path: 'student.gender', label: 'Gender', valueType: 'STRING', group: 'Student' },
    { path: 'student.hostelStatus', label: 'Hostel resident', valueType: 'BOOLEAN', group: 'Student' },
    { path: 'student.transportStatus', label: 'Uses transport', valueType: 'BOOLEAN', group: 'Student' },
    { path: 'student.transportRoute', label: 'Transport route', valueType: 'STRING', group: 'Student' },
    { path: 'student.scholarshipCategory', label: 'Scholarship category', valueType: 'STRING', group: 'Student' },
    { path: 'student.admissionType', label: 'Admission type', valueType: 'STRING', group: 'Student' },
    { path: 'student.academicScore', label: 'Academic score', valueType: 'NUMBER', group: 'Student' },
    { path: 'student.familyGroup', label: 'Family group', valueType: 'STRING', group: 'Student' },
    { path: 'student.isInternational', label: 'International student', valueType: 'BOOLEAN', group: 'Student' },
    { path: 'student.status', label: 'Student status', valueType: 'STRING', group: 'Student' },
    { path: 'student.siblingCount', label: 'Siblings enrolled', valueType: 'NUMBER', group: 'Student' },
    { path: 'student.tags', label: 'Tags', valueType: 'STRING', group: 'Student' },
    { path: 'fee.type', label: 'Fee type code', valueType: 'STRING', group: 'Fee' },
    { path: 'fee.category', label: 'Fee category code', valueType: 'STRING', group: 'Fee' },
    { path: 'fee.frequency', label: 'Fee frequency', valueType: 'ENUM', group: 'Fee' },
    { path: 'fee.optionality', label: 'Fee optionality', valueType: 'ENUM', group: 'Fee' },
    { path: 'fee.amount', label: 'Fee base amount', valueType: 'NUMBER', group: 'Fee' },
    { path: 'payment.date', label: 'Payment date', valueType: 'DATE', group: 'Payment' },
    { path: 'payment.amount', label: 'Payment amount', valueType: 'NUMBER', group: 'Payment' },
    { path: 'payment.method', label: 'Payment method', valueType: 'STRING', group: 'Payment' },
    { path: 'payment.channel', label: 'Payment channel', valueType: 'ENUM', group: 'Payment' },
    { path: 'payment.isEarlyPayment', label: 'Paid before early-payment cutoff', valueType: 'BOOLEAN', group: 'Payment' },
    { path: 'academicYear.name', label: 'Academic year', valueType: 'STRING', group: 'Academic' },
    { path: 'academicYear.startDate', label: 'Academic year start', valueType: 'DATE', group: 'Academic' },
    { path: 'academicYear.endDate', label: 'Academic year end', valueType: 'DATE', group: 'Academic' },
    { path: 'history.outstandingAmount', label: 'Current outstanding', valueType: 'NUMBER', group: 'History' },
    { path: 'history.arrearsAmount', label: 'Arrears carried forward', valueType: 'NUMBER', group: 'History' },
    { path: 'history.daysLate', label: 'Days late', valueType: 'NUMBER', group: 'History' },
    { path: 'history.installmentsPaid', label: 'Installments paid', valueType: 'NUMBER', group: 'History' },
    { path: 'history.isRenewal', label: 'Continuing student', valueType: 'BOOLEAN', group: 'History' },
    { path: 'evaluationDate', label: 'Evaluation date', valueType: 'DATE', group: 'Academic' },
];
/** Facts a custom attribute can be referenced through: `custom.<key>`. */
exports.CUSTOM_FACT_PREFIX = 'custom.';
/**
 * Builds a condition tree from flat rows. Rows sharing a `groupIndex` are
 * AND-ed; groups are combined with each row's `logicalWith`, letting a tenant
 * express `(A AND B) OR (C AND D)` without a bespoke tree editor.
 */
function conditionsFromFlatRows(rows) {
    if (rows.length === 0)
        return undefined;
    const groups = new Map();
    for (const row of rows) {
        const index = row.groupIndex ?? 0;
        const bucket = groups.get(index);
        if (bucket)
            bucket.push(row);
        else
            groups.set(index, [row]);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
    const nodes = ordered.map(([, bucket]) => {
        const leaves = bucket.map((row) => ({
            kind: 'condition',
            field: row.field,
            operator: row.operator,
            value: row.value,
            valueType: row.valueType,
            negate: row.negate,
        }));
        if (leaves.length === 1)
            return leaves[0];
        return { kind: 'group', op: 'AND', children: leaves };
    });
    if (nodes.length === 1) {
        const only = nodes[0];
        // The first group's logicalWith applies to how it combines with the rest;
        // with a single group there is nothing to combine, so return it directly.
        return only;
    }
    const rootOp = ordered[1]?.[1][0]?.logicalWith ?? 'AND';
    return { kind: 'group', op: rootOp, children: nodes };
}
//# sourceMappingURL=fee.js.map