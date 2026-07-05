import { parseBankStatement } from '@shared/bankStatement'
import type { StatementParseResult } from '@shared/types'

interface PdfTextItem {
  str: string
  transform: number[]
}

/**
 * Extract the text of a PDF as visual lines: items sharing a baseline are one
 * line, ordered left to right, pages top to bottom.
 */
async function extractPdfLines(data: Uint8Array): Promise<string[]> {
  // Dynamic import: pdfjs-dist is ESM-only and the main bundle is CJS.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  try {
    const lines: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const byBaseline = new Map<number, { x: number; str: string }[]>()
      for (const item of content.items as PdfTextItem[]) {
        if (typeof item.str !== 'string' || item.str.trim() === '') continue
        const y = Math.round(item.transform[5])
        let row = byBaseline.get(y)
        if (!row) byBaseline.set(y, (row = []))
        row.push({ x: item.transform[4], str: item.str })
      }
      const ys = [...byBaseline.keys()].sort((a, b) => b - a)
      for (const y of ys) {
        const row = byBaseline.get(y)!
        row.sort((a, b) => a.x - b.x)
        lines.push(row.map((part) => part.str).join(' '))
      }
      page.cleanup()
    }
    return lines
  } finally {
    await doc.destroy()
  }
}

export async function parseStatementPdf(
  data: ArrayBuffer | Uint8Array
): Promise<StatementParseResult> {
  // Always rewrap: pdf.js rejects Uint8Array subclasses like Node's Buffer,
  // which is what Electron IPC delivers binary arguments as.
  const bytes =
    data instanceof Uint8Array
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data)
  if (bytes.length === 0) throw new Error('The PDF file is empty')
  let lines: string[]
  try {
    lines = await extractPdfLines(bytes)
  } catch (err) {
    throw new Error(`Could not read the PDF: ${err instanceof Error ? err.message : String(err)}`)
  }
  const result = parseBankStatement(lines)
  if (result.transactions.length === 0) {
    throw new Error(
      'No transactions found in this PDF. Only text-based bank statements (e.g. CommBank) are supported — scanned images cannot be read.'
    )
  }
  return result
}
