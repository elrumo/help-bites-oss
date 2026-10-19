import type { EmailBlock, EmailBlockType } from '#shared/email/blocks'

/** Display name, icon and a one-line hint per block type: the Add menu, layers and inspector. */
export const EMAIL_BLOCK_META: Record<EmailBlockType, { label: string, icon: string, description: string }> = {
  heading: { label: 'Heading', icon: 'i-lucide-heading', description: 'A title, H1 to H3' },
  text: { label: 'Text', icon: 'i-lucide-type', description: 'Paragraphs with bold, italic and links' },
  button: { label: 'Button', icon: 'i-lucide-mouse-pointer-click', description: 'A call to action, or a pill' },
  image: { label: 'Image', icon: 'i-lucide-image', description: 'A picture, logo or badge' },
  divider: { label: 'Divider', icon: 'i-lucide-minus', description: 'A hairline between parts' },
  spacer: { label: 'Spacer', icon: 'i-lucide-move-vertical', description: 'Empty space' },
  section: { label: 'Section', icon: 'i-lucide-square-dashed', description: 'Blocks on one surface: a card, a coloured band' },
  columns: { label: 'Columns', icon: 'i-lucide-columns-2', description: 'Blocks side by side' },
  html: { label: 'Custom HTML', icon: 'i-lucide-code', description: 'Your own email HTML' },
  component: { label: 'Component', icon: 'i-lucide-puzzle', description: 'A saved component from the library' }
}

/** What a block added from the editor starts with, over its defaults: a section you can see. */
export const EMAIL_BLOCK_START: Partial<Record<EmailBlockType, Record<string, unknown>>> = {
  section: { background: '#f4f4f5', radius: 8, padding: 24 }
}

/** CSS shadows offered for sections and buttons. */
export const EMAIL_SHADOWS = [
  { label: 'Subtle', value: '0 2px 4px rgba(0, 0, 0, 0.1)' },
  { label: 'Soft', value: '0 10px 30px rgba(20, 35, 60, 0.08)' },
  { label: 'Lifted', value: '0 4px 10px rgba(0, 0, 0, 0.2)' }
]

/** A short name for a block: its copy when it has some, else its type. */
export function emailBlockLabel(b: EmailBlock): string {
  const copy = b.type === 'heading' ? b.text
    : b.type === 'text' ? b.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      : b.type === 'button' ? b.label
        : b.type === 'image' ? b.alt
          : b.type === 'component' ? b.name
            : ''
  return copy?.trim().slice(0, 40) || EMAIL_BLOCK_META[b.type]?.label || b.type
}
