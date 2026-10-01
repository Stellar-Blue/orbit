import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Text layer of a PDF, read on the SERVER.
 *
 * The payroll documents people attach here (payroll-provider payslips, bank transfer confirmations)
 * are digital PDFs with a real text layer, so their text is exact and costs a few hundred tokens
 * instead of a picture. Doing this server-side avoids shipping a PDF renderer — and a worker — to
 * the browser: the client only forwards the stored data URL.
 *
 * Uses the `legacy` build, which is the one that runs under Node (it installs the fake worker itself).
 */

/** Below this many characters a PDF is treated as having no usable text layer (a scan). */
const MIN_TEXT = 40;
const MAX_PAGES = 4;

export function splitDataUrl(url: string): { mime: string; base64: string } | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma === -1) return null;
  const semi = url.indexOf(';');
  return { mime: url.slice(5, semi > 0 && semi < comma ? semi : comma), base64: url.slice(comma + 1) };
}

/** Extracted text, or null when the PDF has no usable text layer (a scan) or cannot be opened. */
export async function extractPdfText(dataUrl: string): Promise<string | null> {
  const parts = splitDataUrl(dataUrl);
  if (!parts || !/pdf/i.test(parts.mime)) return null;

  try {
    const bytes = new Uint8Array(Buffer.from(parts.base64, 'base64'));
    const pdf = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
      if (pageText.length >= MIN_TEXT) text += `${text ? '\n' : ''}${pageText}`;
    }
    return text.length >= MIN_TEXT ? text : null;
  } catch (e) {
    console.error('pdf text extraction failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
