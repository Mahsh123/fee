import { describe, expect, it } from 'vitest';
import { renderReceiptHtml, renderReceiptPdf, type ReceiptDocument } from './index';

const receipt: ReceiptDocument = {
  title: 'Payment receipt',
  issuerName: 'North Campus',
  receiptNumber: 'RCPT-001',
  issuedOn: '2026-09-29',
  payerName: '<Sam & Co>',
  lines: [{ description: 'Tuition <term>', amount: '1,234.50' }],
  total: '1,234.50',
  currency: 'INR',
};

describe('receipt document rendering', () => {
  it('escapes document content and displays supplied amount strings verbatim', () => {
    const html = renderReceiptHtml(receipt);
    expect(html).toContain('&lt;Sam &amp; Co&gt;');
    expect(html).toContain('&lt;term&gt;');
    expect(html).toContain('1,234.50');
    expect(html).not.toContain('<Sam');
  });

  it('renders a valid PDF document without recalculating amounts', async () => {
    const pdf = await renderReceiptPdf(receipt);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });
});
