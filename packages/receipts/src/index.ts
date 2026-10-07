import PDFDocument from 'pdfkit';

export interface ReceiptDocument {
  title: string;
  issuerName: string;
  receiptNumber: string;
  issuedOn: string;
  payerName: string;
  lines: Array<{ description: string; amount: string }>;
  total: string;
  currency: string;
  footer?: string;
}

/** Produces an escaped, printable receipt view from caller-provided document data. */
export function renderReceiptHtml(receipt: ReceiptDocument): string {
  const lines = receipt.lines.map((line) =>
    `<tr><td>${escapeHtml(line.description)}</td><td class="amount">${escapeHtml(line.amount)}</td></tr>`,
  ).join('');
  const footer = receipt.footer ? `<footer>${escapeHtml(receipt.footer)}</footer>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(receipt.title)}</title><style>body{font:16px system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#172033}header,footer{margin:1.5rem 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.6rem;border-bottom:1px solid #d8dee9}.amount{text-align:right}tfoot{font-weight:700}</style></head><body><header><h1>${escapeHtml(receipt.issuerName)}</h1><p>${escapeHtml(receipt.title)} · ${escapeHtml(receipt.receiptNumber)}</p><p>${escapeHtml(receipt.issuedOn)}</p></header><section><h2>Received from</h2><p>${escapeHtml(receipt.payerName)}</p></section><table><thead><tr><th>Description</th><th class="amount">Amount (${escapeHtml(receipt.currency)})</th></tr></thead><tbody>${lines}</tbody><tfoot><tr><td>Total</td><td class="amount">${escapeHtml(receipt.total)}</td></tr></tfoot></table>${footer}</body></html>`;
}

/** Renders the caller's already-formatted amounts; this package never performs money arithmetic. */
export function renderReceiptPdf(receipt: ReceiptDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', reject);

    document.fontSize(20).text(receipt.issuerName);
    document.moveDown(0.5).fontSize(14).text(receipt.title);
    document.fontSize(10).text(`Receipt ${receipt.receiptNumber} · ${receipt.issuedOn}`);
    document.moveDown().fontSize(12).text(`Received from: ${receipt.payerName}`);
    document.moveDown();
    for (const line of receipt.lines) {
      document.fontSize(11).text(line.description, { continued: true });
      document.text(`${line.amount} ${receipt.currency}`, { align: 'right' });
    }
    document.moveDown().fontSize(13).text(`Total: ${receipt.total} ${receipt.currency}`, { align: 'right' });
    if (receipt.footer) document.moveDown().fontSize(9).text(receipt.footer);
    document.end();
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}
