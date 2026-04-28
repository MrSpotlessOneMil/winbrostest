#!/usr/bin/env node
/**
 * Phase E — generate mockup service-plan agreement PDFs for WinBros.
 *
 * No external library needed: we hand-write a minimal valid PDF using
 * the PDF object spec. Each plan gets a single 8.5×11 page with the
 * plan name, recurring price, recurrence, and a stub paragraph that
 * Dominic will replace with real agreement language later.
 *
 * Output: public/service-plans/winbros-{slug}-agreement.pdf
 *
 * Run: node scripts/generate-winbros-plan-mockup-pdfs.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLANS = [
  {
    slug: 'monthly',
    name: 'Monthly',
    price: 99,
    visits: '12 visits per year, every month',
    blurb:
      'High-traffic homes and short-cycle commercial. We are on-site every month so each visit is fast and the price stays low.',
  },
  {
    slug: 'quarterly',
    name: 'Quarterly',
    price: 225,
    visits: '4 visits per year, every 3 months',
    blurb:
      'Most popular plan. We come out every 3 months to keep your windows looking great year-round without overpaying for visits you do not need.',
  },
  {
    slug: 'triannual',
    name: 'Triannual',
    price: 285,
    visits: '3 visits per year, every 4 months',
    blurb:
      'Three visits a year timed for spring, mid-summer, and fall. Best value per visit if you are happy with windows that look great most of the year.',
  },
]

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'window-washing',
  'public',
  'service-plans'
)

/**
 * Build a tiny single-page PDF (8.5×11 in / 612×792 pt) with the supplied
 * lines of text. Each line is rendered with the standard Helvetica font.
 *
 * Hand-written following the PDF 1.4 reference. This is intentionally
 * minimal — readable in any modern viewer (Chrome, Preview, Adobe).
 */
function buildPdf(title, lines) {
  const lineHeight = 16
  const startY = 720 // top margin
  const leftX = 60
  // Build the content stream.
  const contentLines = []
  contentLines.push('BT')
  contentLines.push(`/F1 22 Tf`)
  contentLines.push(`${leftX} ${startY} Td`)
  contentLines.push(`(${escapePdf(title)}) Tj`)
  contentLines.push('ET')
  let y = startY - 36
  contentLines.push('BT')
  contentLines.push(`/F1 12 Tf`)
  for (const line of lines) {
    contentLines.push(`${leftX} ${y} Td`)
    contentLines.push(`(${escapePdf(line)}) Tj`)
    contentLines.push(`0 -${lineHeight} Td`)
    y -= lineHeight
  }
  contentLines.push('ET')
  const stream = contentLines.join('\n')

  const objects = []
  // 1: Catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  // 2: Pages
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  // 3: Page
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
  )
  // 4: Font
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  // 5: Content stream
  const streamBytes = Buffer.byteLength(stream, 'latin1')
  objects.push(`<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`)

  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  body += `startxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function escapePdf(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  for (const plan of PLANS) {
    const lines = [
      `WinBros Window Cleaning — ${plan.name} Service Plan`,
      '',
      `Price per visit: $${plan.price.toFixed(2)}`,
      `Schedule: ${plan.visits}`,
      '',
      'Plan summary:',
      ...wrapLines(plan.blurb, 80),
      '',
      'MOCKUP DOCUMENT — Phase E placeholder.',
      'The owner will replace this with the official agreement language.',
      '',
      'By signing the customer-facing quote view at /quote/<token>, the',
      'customer authorizes recurring billing per visit on the cadence',
      'shown above. Either party may cancel with 30 days written notice;',
      'no early-termination fees apply. Pricing is fixed for the first',
      '12 months from signature.',
      '',
      'WinBros — Morton, IL.',
    ]
    const pdf = buildPdf(`${plan.name} Service Plan Agreement (Mockup)`, lines)
    const outPath = path.join(OUT_DIR, `winbros-${plan.slug}-agreement.pdf`)
    await fs.writeFile(outPath, pdf)
    console.log(`wrote ${outPath} (${pdf.byteLength} bytes)`)
  }
}

function wrapLines(text, maxChars) {
  const words = text.split(/\s+/)
  const out = []
  let current = ''
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      out.push(current.trim())
      current = w
    } else {
      current += ' ' + w
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
