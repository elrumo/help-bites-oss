import { DEFAULT_SETTINGS, emptyDocument, type EmailDocument } from './blocks'

export type EmailTemplateType = 'Launch' | 'Newsletter' | 'Promotion' | 'Welcome' | 'Event' | 'Transactional'
export type EmailTemplateStyle = 'Minimal' | 'Bold' | 'Editorial' | 'Soft' | 'Dark' | 'Utility'

export interface EmailTemplateDefinition {
  id: string
  name: string
  type: EmailTemplateType
  style: EmailTemplateStyle
  icon: string
  accent: string
  description: string
  document: EmailDocument
}

const fontFamily = DEFAULT_SETTINGS.fontFamily

export const EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  {
    id: 'launch-bold',
    name: 'Product launch',
    type: 'Launch',
    style: 'Bold',
    icon: 'i-lucide-rocket',
    accent: '#2563eb',
    description: 'Hero, feature columns, and one direct call to action.',
    document: {
      settings: {
        ...DEFAULT_SETTINGS,
        title: 'Introducing your new product',
        preheader: 'Meet the release your customers have been waiting for.',
        backgroundColor: '#eef2ff',
        contentBackground: '#ffffff',
        textColor: '#111827',
        fontFamily
      },
      blocks: [
        { id: 'launch_eyebrow', type: 'text', html: '<b>New release</b>', align: 'center', fontSize: 13, color: '#2563eb', padding: 18 },
        { id: 'launch_headline', type: 'heading', text: 'Build faster with the new workspace', level: 1, align: 'center', color: '#111827', padding: 8 },
        { id: 'launch_intro', type: 'text', html: 'A cleaner dashboard, smarter automation, and instant visibility across the tools your team already uses.', align: 'center', fontSize: 16, color: '#4b5563', padding: 16 },
        { id: 'launch_image', type: 'image', src: 'https://dummyimage.com/1120x520/2563eb/ffffff&text=Product+preview', alt: 'Product preview', align: 'center', padding: 18 },
        {
          id: 'launch_features',
          type: 'columns',
          gap: 18,
          padding: 18,
          columns: [
            [
              { id: 'launch_feature_1_title', type: 'heading', text: 'Automate', level: 3, align: 'left', color: '#111827', padding: 0 },
              { id: 'launch_feature_1_copy', type: 'text', html: 'Trigger reliable workflows from your team events.', align: 'left', color: '#4b5563', padding: 6 }
            ],
            [
              { id: 'launch_feature_2_title', type: 'heading', text: 'Monitor', level: 3, align: 'left', color: '#111827', padding: 0 },
              { id: 'launch_feature_2_copy', type: 'text', html: 'Spot issues early with concise status snapshots.', align: 'left', color: '#4b5563', padding: 6 }
            ]
          ]
        },
        { id: 'launch_cta', type: 'button', label: 'Explore the launch', href: 'https://example.com', align: 'center', backgroundColor: '#2563eb', color: '#ffffff', radius: 6, padding: 22 }
      ]
    }
  },
  {
    id: 'newsletter-editorial',
    name: 'Editorial digest',
    type: 'Newsletter',
    style: 'Editorial',
    icon: 'i-lucide-newspaper',
    accent: '#0f766e',
    description: 'A calm issue layout with lead story, links, and notes.',
    document: {
      settings: {
        ...DEFAULT_SETTINGS,
        title: 'Weekly digest',
        preheader: 'The most useful updates from this week.',
        backgroundColor: '#f5f7f4',
        contentBackground: '#ffffff',
        textColor: '#17211c',
        fontFamily
      },
      blocks: [
        { id: 'digest_masthead', type: 'text', html: '<b>THE WEEKLY DIGEST</b>', align: 'center', fontSize: 12, color: '#0f766e', padding: 20 },
        { id: 'digest_title', type: 'heading', text: 'Three ideas worth your Friday', level: 1, align: 'center', color: '#17211c', padding: 8 },
        { id: 'digest_divider_top', type: 'divider', color: '#d6ded8', thickness: 1, padding: 14 },
        { id: 'digest_lead', type: 'heading', text: 'Lead story: simpler systems win', level: 2, align: 'left', color: '#17211c', padding: 18 },
        { id: 'digest_copy', type: 'text', html: 'A short, readable opening note that frames the issue and gives subscribers a reason to keep scrolling.', align: 'left', fontSize: 15, color: '#3f4f46', padding: 18 },
        {
          id: 'digest_links',
          type: 'columns',
          gap: 18,
          padding: 18,
          columns: [
            [{ id: 'digest_link_1', type: 'text', html: '<b>Read</b><br>How to ship calmer releases.', align: 'left', color: '#3f4f46', padding: 0 }],
            [{ id: 'digest_link_2', type: 'text', html: '<b>Watch</b><br>A five-minute product teardown.', align: 'left', color: '#3f4f46', padding: 0 }]
          ]
        },
        { id: 'digest_button', type: 'button', label: 'Read the full issue', href: 'https://example.com', align: 'left', backgroundColor: '#0f766e', color: '#ffffff', radius: 4, padding: 18 },
        { id: 'digest_divider_bottom', type: 'divider', color: '#d6ded8', thickness: 1, padding: 14 },
        // What every campaign must carry: who sent it, from where, and the way out.
        { id: 'digest_footer', type: 'text', html: '{{project.name}} · {{project.address}}<br><a href="{{unsubscribeUrl}}">Unsubscribe</a> · <a href="{{preferencesUrl}}">Email preferences</a>', align: 'center', fontSize: 12, color: '#6b7a71', padding: 18 }
      ]
    }
  },
  {
    id: 'promotion-minimal',
    name: 'Flash sale',
    type: 'Promotion',
    style: 'Minimal',
    icon: 'i-lucide-badge-percent',
    accent: '#dc2626',
    description: 'Offer-first copy with a coupon block and compact footer.',
    document: {
      settings: {
        ...DEFAULT_SETTINGS,
        title: '48-hour offer',
        preheader: 'Use your code before the offer ends.',
        backgroundColor: '#fafafa',
        contentBackground: '#ffffff',
        textColor: '#18181b',
        fontFamily
      },
      blocks: [
        { id: 'promo_image', type: 'image', src: 'https://dummyimage.com/1120x420/dc2626/ffffff&text=48-hour+offer', alt: '48 hour offer', align: 'center', padding: 0 },
        { id: 'promo_title', type: 'heading', text: 'Save 25% before midnight', level: 1, align: 'center', color: '#18181b', padding: 24 },
        { id: 'promo_copy', type: 'text', html: 'A focused promotion template for a single offer, collection, or limited-time upgrade.', align: 'center', color: '#52525b', padding: 10 },
        { id: 'promo_code', type: 'html', padding: 18, html: '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border:1px dashed #dc2626;border-radius:6px;padding:16px;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#dc2626;letter-spacing:2px;">SAVE25</td></tr></table>' },
        { id: 'promo_cta', type: 'button', label: 'Shop the offer', href: 'https://example.com', align: 'center', backgroundColor: '#dc2626', color: '#ffffff', radius: 4, padding: 20 },
        { id: 'promo_terms', type: 'text', html: 'Offer ends soon. Terms and exclusions may apply.', align: 'center', fontSize: 12, color: '#71717a', padding: 16 }
      ]
    }
  },
  {
    id: 'welcome-soft',
    name: 'Warm welcome',
    type: 'Welcome',
    style: 'Soft',
    icon: 'i-lucide-hand-heart',
    accent: '#7c3aed',
    description: 'Friendly onboarding with next steps and a helpful CTA.',
    document: {
      settings: {
        ...DEFAULT_SETTINGS,
        title: 'Welcome aboard',
        preheader: 'A few easy steps to get started.',
        backgroundColor: '#f6f2ff',
        contentBackground: '#ffffff',
        textColor: '#22172f',
        fontFamily
      },
      blocks: [
        { id: 'welcome_title', type: 'heading', text: 'Welcome to your new workspace', level: 1, align: 'center', color: '#22172f', padding: 28 },
        { id: 'welcome_intro', type: 'text', html: 'We are glad you are here. Start with these three quick steps, then make the workspace your own.', align: 'center', color: '#5b5266', fontSize: 16, padding: 12 },
        {
          id: 'welcome_steps',
          type: 'columns',
          gap: 12,
          padding: 20,
          columns: [
            [{ id: 'welcome_step_1', type: 'text', html: '<b>1. Connect</b><br>Add the tools you use every day.', align: 'center', color: '#5b5266', padding: 0 }],
            [{ id: 'welcome_step_2', type: 'text', html: '<b>2. Create</b><br>Build a first automation or monitor.', align: 'center', color: '#5b5266', padding: 0 }],
            [{ id: 'welcome_step_3', type: 'text', html: '<b>3. Invite</b><br>Bring your team into the flow.', align: 'center', color: '#5b5266', padding: 0 }]
          ]
        },
        { id: 'welcome_cta', type: 'button', label: 'Start setup', href: 'https://example.com', align: 'center', backgroundColor: '#7c3aed', color: '#ffffff', radius: 8, padding: 20 }
      ]
    }
  },
  {
    id: 'event-dark',
    name: 'Event invite',
    type: 'Event',
    style: 'Dark',
    icon: 'i-lucide-calendar-days',
    accent: '#f59e0b',
    description: 'High-contrast invitation with date, details, and RSVP.',
    document: {
      settings: {
        ...DEFAULT_SETTINGS,
        title: 'You are invited',
        preheader: 'Save your spot for the upcoming session.',
        backgroundColor: '#111827',
        contentBackground: '#1f2937',
        textColor: '#f9fafb',
        fontFamily
      },
      blocks: [
        { id: 'event_kicker', type: 'text', html: '<b>LIVE SESSION</b>', align: 'center', fontSize: 12, color: '#f59e0b', padding: 24 },
        { id: 'event_title', type: 'heading', text: 'Designing resilient automations', level: 1, align: 'center', color: '#ffffff', padding: 8 },
        { id: 'event_date', type: 'html', padding: 18, html: '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:#111827;border-radius:6px;padding:18px;font-family:Arial,sans-serif;color:#f9fafb;"><div style="font-size:13px;color:#f59e0b;font-weight:bold;">JUNE 18</div><div style="font-size:22px;font-weight:bold;margin-top:4px;">10:00 AM PT</div></td></tr></table>' },
        { id: 'event_copy', type: 'text', html: 'Join a practical walkthrough of monitoring, recovery paths, and workflow design patterns that stay readable under pressure.', align: 'center', color: '#d1d5db', fontSize: 15, padding: 16 },
        { id: 'event_cta', type: 'button', label: 'Reserve my seat', href: 'https://example.com', align: 'center', backgroundColor: '#f59e0b', color: '#111827', radius: 6, padding: 22 }
      ]
    }
  },
  {
    id: 'transactional-utility',
    name: 'Account update',
    type: 'Transactional',
    style: 'Utility',
    icon: 'i-lucide-shield-check',
    accent: '#0891b2',
    description: 'Clear system message with status details and support link.',
    document: {
      settings: {
        ...DEFAULT_SETTINGS,
        title: 'Your account was updated',
        preheader: 'A quick confirmation for your records.',
        backgroundColor: '#ecfeff',
        contentBackground: '#ffffff',
        textColor: '#164e63',
        fontFamily
      },
      blocks: [
        { id: 'utility_status', type: 'text', html: '<b>Account update</b>', align: 'left', fontSize: 13, color: '#0891b2', padding: 22 },
        { id: 'utility_title', type: 'heading', text: 'Your settings were saved', level: 1, align: 'left', color: '#164e63', padding: 10 },
        { id: 'utility_copy', type: 'text', html: 'This confirms that your account preferences were updated successfully. No further action is needed.', align: 'left', color: '#475569', fontSize: 15, padding: 16 },
        { id: 'utility_divider', type: 'divider', color: '#cffafe', thickness: 1, padding: 14 },
        { id: 'utility_details', type: 'text', html: '<b>Updated item:</b> Notification preferences<br><b>Effective:</b> Immediately', align: 'left', color: '#475569', padding: 16 },
        { id: 'utility_cta', type: 'button', label: 'View account', href: 'https://example.com', align: 'left', backgroundColor: '#0891b2', color: '#ffffff', radius: 5, padding: 18 }
      ]
    }
  }
]

export function cloneEmailTemplateDocument(templateId: string): EmailDocument | null {
  const template = EMAIL_TEMPLATES.find(t => t.id === templateId)
  return template ? structuredClone(template.document) : null
}

export function cloneBlankEmailDocument(): EmailDocument {
  return emptyDocument()
}

export function isStarterEmailDocument(doc: EmailDocument): boolean {
  return doc.blocks.length === 2 && doc.blocks[0]?.id === 'blk_welcome' && doc.blocks[1]?.id === 'blk_intro'
}
