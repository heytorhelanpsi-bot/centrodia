import PDFDocument from 'pdfkit';

/** Converte o Markdown simples dos relatórios em PDF (títulos, listas, negrito/itálico removidos). */
export function gerarPDF(markdown: string, opts: { rodape: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 56, right: 56 }, bufferPages: true,
      info: { Title: 'Relatório', Producer: 'PsiDia' } });
    const partes: Buffer[] = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    const limpar = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2').replace(/ {2}$/, '');
    for (const linha of markdown.split('\n')) {
      const l = linha.trimEnd();
      if (l.startsWith('# ')) { doc.moveDown(0.3).font('Helvetica-Bold').fontSize(16).fillColor('#123c69').text(limpar(l.slice(2))); doc.moveDown(0.4); }
      else if (l.startsWith('## ')) { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12.5).fillColor('#123c69').text(limpar(l.slice(3))); doc.moveDown(0.2); }
      else if (l.startsWith('### ')) { doc.moveDown(0.4).font('Helvetica-Bold').fontSize(11).fillColor('#222').text(limpar(l.slice(4))); }
      else if (/^\s*[-*] /.test(l)) { doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(`•  ${limpar(l.replace(/^\s*[-*] /, ''))}`, { indent: 10 }); }
      else if (l === '---') { doc.moveDown(0.5); const y = doc.y; doc.moveTo(56, y).lineTo(539, y).strokeColor('#bbb').stroke(); doc.moveDown(0.5); }
      else if (l === '') { doc.moveDown(0.4); }
      else { doc.font(l.startsWith('_') ? 'Helvetica-Oblique' : 'Helvetica').fontSize(10.5).fillColor('#222').text(limpar(l), { align: 'justify' }); }
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#666')
        .text(`${opts.rodape} — página ${i + 1} de ${range.count}`, 56, doc.page.height - 40, { width: 483, align: 'center' });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
