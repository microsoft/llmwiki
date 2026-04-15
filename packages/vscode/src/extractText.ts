import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Extract text content from a file based on its extension.
 * Supports: .md, .txt, .json, .csv, .xml, .html (read as-is),
 *           .pdf (via pdf-parse), .docx (via mammoth).
 */
export async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return extractPdf(filePath);
    case '.docx':
      return extractDocx(filePath);
    default:
      // All other files: read as UTF-8 text
      return readFile(filePath, 'utf-8');
  }
}

async function extractPdf(filePath: string): Promise<string> {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
  // Point worker to the bundled worker file using a file:// URL
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const buffer = await readFile(filePath);
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item: unknown): item is { str: string } =>
        typeof item === 'object' && item !== null && 'str' in item)
      .map((item: { str: string }) => item.str)
      .join(' ');
    pages.push(text);
  }

  return pages.join('\n\n');
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}
