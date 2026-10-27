/** In-app report PDF export: render self-contained HTML off-screen and write a PDF
 * file directly via printToPDF. This intentionally bypasses Chromium's print preview:
 * closing that preview leaves the hosting WebContents blank in the packaged app
 * (observed 2026-10-27 on the douyin report tab), so the renderer asks the main
 * process to produce the PDF instead of calling window.print(). */
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, type BrowserWindowConstructorOptions } from 'electron'

export type ReportPdfExportResult =
  | { ok: true; filePath: string }
  | { ok: false; reason: 'invalid-payload' | 'cancelled' | 'pdf-failed' }

const MAX_HTML_BYTES = 4 * 1024 * 1024
const PRINT_TIMEOUT_MS = 30_000
const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  show: false,
  webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false },
}

const sanitizeFilename = (value: unknown): string => {
  if (typeof value !== 'string') return 'report.pdf'
  const cleaned = value.replace(/[\\/:*?"<>|\r\n]/g, '_').trim()
  return cleaned.length > 0 && cleaned.length <= 180 ? cleaned : 'report.pdf'
}

export async function exportReportPdf(parent: BrowserWindow, payload: unknown): Promise<ReportPdfExportResult> {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid-payload' }
  const { html, filename } = payload as { html?: unknown; filename?: unknown }
  if (typeof html !== 'string' || html.length === 0 || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, reason: 'invalid-payload' }
  }
  const safeName = sanitizeFilename(filename)
  const save = await dialog.showSaveDialog(parent, {
    title: safeName,
    defaultPath: safeName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (save.canceled || !save.filePath) return { ok: false, reason: 'cancelled' }
  const window = new BrowserWindow(WINDOW_OPTIONS)
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await Promise.race([
      window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('printToPDF timeout')), PRINT_TIMEOUT_MS)),
    ])
    await writeFile(save.filePath, pdf)
    return { ok: true, filePath: save.filePath }
  } catch {
    return { ok: false, reason: 'pdf-failed' }
  } finally {
    window.destroy()
  }
}
