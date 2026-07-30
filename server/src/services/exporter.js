const PDFDocument = require('pdfkit');

const CSV_HEADERS = ['Date', 'Item', 'Quantity', 'Unit Price', 'Total', 'Estimated Price?'];

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function entriesToCsv(rows) {
  const lines = [CSV_HEADERS.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(
      [
        new Date(row.occurred_at).toISOString(),
        row.item,
        row.quantity,
        row.unit_price ?? '',
        row.total_amount,
        row.is_estimated ? 'yes' : 'no',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}

function money(n) {
  return `${Number(n).toFixed(2)}`;
}

// A statement-style layout a loan officer can skim: identity + range up
// top, headline numbers next, then the itemized entries. Built with
// pdfkit's plain text/line primitives rather than a table library — the
// row count per statement is small enough that manual column positions
// are simpler than pulling in a grid component.
function streamEntriesToPdf(res, { username, from, to, summary, rows }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  doc.fontSize(20).text('SokoLedger Revenue Statement', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#555').text(`Trader: ${username}`);
  doc.text(`Period: ${from ? new Date(from).toLocaleDateString() : 'all time'} — ${to ? new Date(to).toLocaleDateString() : 'present'}`);
  doc.fillColor('#000');
  doc.moveDown();

  if (summary) {
    doc.fontSize(13).text('Summary');
    doc.fontSize(10);
    doc.text(`Total revenue: ${money(summary.totalRevenue)}`);
    doc.text(`Average daily revenue: ${money(summary.avgDailyRevenue)}`);
    if (summary.topItems?.length) {
      doc.text(`Top-selling item: ${summary.topItems[0].item} (${money(summary.topItems[0].revenue)})`);
    }
    doc.moveDown();
  }

  doc.fontSize(13).text('Entries');
  doc.moveDown(0.3);

  const colX = { date: 50, item: 140, qty: 300, unit: 360, total: 440 };
  const rowHeight = 16;
  doc.fontSize(9).fillColor('#333');
  const drawHeader = () => {
    doc.text('Date', colX.date, doc.y, { continued: false });
    doc.text('Item', colX.item, doc.y - 10);
    doc.text('Qty', colX.qty, doc.y - 10);
    doc.text('Unit', colX.unit, doc.y - 10);
    doc.text('Total', colX.total, doc.y - 10);
    doc.moveDown(0.5);
    doc.fillColor('#000');
  };
  drawHeader();

  for (const row of rows) {
    if (doc.y > doc.page.height - 80) {
      doc.addPage();
      doc.fontSize(9);
    }
    const y = doc.y;
    doc.text(new Date(row.occurred_at).toLocaleDateString(), colX.date, y, { width: 85 });
    doc.text(row.item, colX.item, y, { width: 150 });
    doc.text(String(row.quantity), colX.qty, y, { width: 55 });
    doc.text(row.unit_price ? money(row.unit_price) + (row.is_estimated ? ' (est.)' : '') : '—', colX.unit, y, { width: 75 });
    doc.text(money(row.total_amount), colX.total, y, { width: 90 });
    doc.moveDown(rowHeight / doc.currentLineHeight());
  }

  doc.end();
}

module.exports = { entriesToCsv, streamEntriesToPdf };
