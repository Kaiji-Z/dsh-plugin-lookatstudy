/**
 * Server-side markdown → HTML for the study workbench's 讲解 view. Escapes
 * every HTML character first, then renders a pragmatic GFM subset (headings,
 * fenced code, inline code, bold/italic, links, lists, blockquotes, tables,
 * hr, paragraphs). Lesson bodies are imported teaching material, so raw HTML
 * never passes through.
 * @module dsh-plugin-lookatstudy/markdown
 */

/** Escape all HTML-significant characters. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Render inline markup (code, bold, italic, links) over escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

/** True when the line opens a GFM table row (pipes with a delimiter row next). */
function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|', 1)
}

function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c))
}

/** Split a table row into trimmed cells (leading/trailing pipes removed). */
function rowCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

/**
 * Render markdown text to sanitized HTML.
 * @param md - markdown source (lesson body).
 * @returns HTML string safe to inject into the page.
 */
export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split(/\r?\n/)
  const out: string[] = []
  let i = 0

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length > 0) out.push(`<p>${inline(buffer.join(' '))}</p>`)
  }

  let paragraph: string[] = []
  while (i < lines.length) {
    const line = lines[i]!

    // Fenced code block
    const fence = /^```(\w*)\s*$/.exec(line.trim())
    if (fence) {
      flushParagraph(paragraph)
      paragraph = []
      const lang = fence[1] ?? ''
      const code: string[] = []
      i++
      while (i < lines.length && lines[i]!.trim() !== '```') {
        code.push(lines[i]!)
        i++
      }
      i++ // closing fence
      out.push(`<pre><code${lang === '' ? '' : ` class="lang-${lang}"`}>${code.join('\n')}</code></pre>`)
      continue
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph(paragraph)
      paragraph = []
      const level = heading[1]!.length
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(paragraph)
      paragraph = []
      out.push('<hr>')
      i++
      continue
    }

    // Blockquote
    if (/^\s*&gt;\s?/.test(line)) {
      flushParagraph(paragraph)
      paragraph = []
      const quote: string[] = []
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s*&gt;\s?/, ''))
        i++
      }
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`)
      continue
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(paragraph)
      paragraph = []
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(`<li>${inline(lines[i]!.replace(/^\s*[-*+]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(paragraph)
      paragraph = []
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(`<li>${inline(lines[i]!.replace(/^\s*\d+\.\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // GFM table
    if (isTableRow(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1]!)) {
      flushParagraph(paragraph)
      paragraph = []
      const headers = rowCells(line)
      i += 2
      const rows: string[] = []
      while (i < lines.length && isTableRow(lines[i]!)) {
        const cells = rowCells(lines[i]!)
        rows.push(`<tr>${cells.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`)
        i++
      }
      out.push(`<table><thead><tr>${headers.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`)
      continue
    }

    // Blank line ends the paragraph
    if (line.trim() === '') {
      flushParagraph(paragraph)
      paragraph = []
      i++
      continue
    }

    paragraph.push(line.trim())
    i++
  }
  flushParagraph(paragraph)
  return out.join('\n')
}
