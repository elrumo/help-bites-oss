import type { EmailDocument } from '#shared/email/blocks'
import { renderEmailHtml } from '#shared/email/render'
import type { TemplateVariable } from '#shared/email/resolve'

// The Export menu, shared by the editor and the template lists. HTML is the
// email as it goes out (brand and sample values filled in); JSON is the design
// itself, placeholders intact, to keep or bring back later.

export type EmailExportSource = { name: string, rendered: EmailDocument, design: EmailDocument, variables: TemplateVariable[] }

export function useEmailExport() {
  const toast = useToast()

  function download(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const a = window.document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const file = (name: string) => (name || 'email').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'email'

  return function exportItems(source: () => EmailExportSource, openApi?: () => void) {
    return [
      { label: 'Download HTML', icon: 'i-lucide-download', onSelect: () => { const s = source(); download(renderEmailHtml(s.rendered), `${file(s.name)}.html`, 'text/html') } },
      { label: 'Copy HTML', icon: 'i-lucide-clipboard', onSelect: async () => {
        await navigator.clipboard.writeText(renderEmailHtml(source().rendered))
        toast.add({ title: 'Email HTML copied', icon: 'i-lucide-clipboard-check', color: 'success' as const })
      } },
      { label: 'Export JSON', icon: 'i-lucide-file-json', onSelect: () => { const s = source(); download(JSON.stringify({ name: s.name, document: s.design, variables: s.variables }, null, 2), `${file(s.name)}.json`, 'application/json') } },
      ...(openApi ? [{ label: 'Use via API', icon: 'i-lucide-webhook', onSelect: openApi }] : [])
    ]
  }
}
