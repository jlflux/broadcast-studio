// Reads the text out of a roster PDF (line by line, left to right) so it can
// go through parseRoster. Used by the stat keeper and the Team builder.
export async function pdfText(file) {
  const pdfjs = await import('/vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
  const lines = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 3);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push([item.transform[4], item.str.trim()]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => lines.push(items.sort((a, b) => a[0] - b[0]).map(i => i[1]).join(' ')));
  }
  if (!lines.length) throw new Error('No text found in that PDF. Scanned PDFs are not supported; paste the roster instead.');
  return lines.join('\n');
}
