import type { LegalClause, LegalDocType, When } from './types'

// The clause library: reviewed starting text the composer assembles into a
// document, so most documents need no AI at all. `{{variable}}` placeholders
// are filled from the wizard's answers (see composeVariables). Each clause
// lists the rulepack requirement ids it answers. This text is a starting
// point, not legal advice: have a lawyer review it for your product.

const EU_UK_BR: When = { regions: ['eu', 'uk', 'br'] }
const US: When = { regions: ['us-ca', 'us-other'] }

function clause(docType: LegalDocType, key: string, order: number, heading: string, body: string, rest: { when?: When, satisfies?: string[] } = {}): LegalClause {
  return { id: `${docType}.${key}`, docType, heading, order, body: body.trim(), ...rest }
}

const privacy: LegalClause[] = [
  clause('privacy', 'who', 10, 'Who we are',
    `{{app_name}} is operated by {{operator}} ("we", "us"). This policy explains what personal data we collect when you use {{app_name}}, why we collect it, who we share it with, and the choices you have.`,
    { satisfies: ['privacy-core-who', 'gdpr-13-1a', 'lgpd-9-controller'] }),
  clause('privacy', 'dpo', 20, 'Data protection officer', `{{dpo_line}}`, { when: EU_UK_BR, satisfies: ['gdpr-13-1b', 'lgpd-41-dpo'] }),
  clause('privacy', 'collect', 30, 'Information we collect',
    `We collect the following information. Some you give us directly, some is collected automatically from your device, and some comes from the services listed below.

{{data_collected_list}}`,
    { satisfies: ['privacy-core-collect', 'ccpa-categories-collected', 'ccpa-sources-purposes', 'au-app1-kinds', 'apple-5-1-1-policy', 'gplay-user-data', 'pipeda-4-8-openness', 'us-states-notice'] }),
  clause('privacy', 'use', 40, 'How we use information',
    `We use the information we collect to:

- provide, maintain and secure {{app_name}};
- create and manage your account and, where relevant, process purchases;
- understand how {{app_name}} is used and improve it;
- respond to your questions and support requests;
- detect and prevent fraud, abuse and security incidents; and
- meet our legal obligations.`,
    { satisfies: ['privacy-core-use', 'ccpa-sources-purposes', 'lgpd-9-purpose', 'au-app1-purposes', 'apple-5-1-1-policy'] }),
  clause('privacy', 'legal-bases', 45, 'Legal bases for processing',
    `Where the law requires us to have a legal basis for using your personal data, we rely on:

- **Contract**: to provide {{app_name}} and the features you ask for;
- **Consent**: where you have agreed, for example to optional analytics or marketing. You can withdraw consent at any time;
- **Legitimate interests**: to keep {{app_name}} secure, prevent abuse, understand and improve the service, and provide support. We balance these interests against your rights; and
- **Legal obligation**: where we must keep or share data to comply with the law.

Giving us the account details we ask for is necessary to create an account and use {{app_name}}. Without them we cannot provide it.`,
    { when: EU_UK_BR, satisfies: ['gdpr-13-1c', 'gdpr-13-1d', 'gdpr-13-2e', 'uk-gdpr-13', 'lgpd-9-purpose'] }),
  clause('privacy', 'sharing', 50, 'Who we share information with',
    `We share personal data only with service providers that help us run {{app_name}}, and only as needed for that purpose:

{{processors_list}}

We may also disclose information when the law requires it, to protect the rights and safety of our users or others, or as part of a merger or sale of the business. We do not allow our service providers to use your data for their own marketing.`,
    { satisfies: ['privacy-core-sharing', 'gdpr-13-1e', 'ccpa-disclosed-categories', 'lgpd-9-sharing', 'us-states-notice', 'apple-5-1-1-policy', 'gplay-user-data', 'pipeda-4-8-openness'] }),
  clause('privacy', 'no-sale', 55, 'We do not sell your data',
    `We do not sell personal information, and we do not share it for cross-context behavioural advertising.`,
    { when: { regions: ['us-ca', 'us-other'], is: { sells_or_shares_data: false } }, satisfies: ['ccpa-disclosed-categories'] }),
  clause('privacy', 'sale-optout', 55, 'Sale and sharing of personal information',
    `We sell or share some personal information, for example advertising identifiers, with advertising partners. You can opt out at any time by emailing {{contact_email}}. We also honour opt-out preference signals, such as Global Privacy Control, sent by your browser.`,
    { when: { regions: ['us-ca', 'us-other'], is: { sells_or_shares_data: true } }, satisfies: ['ccpa-opt-out'] }),
  clause('privacy', 'ai', 58, 'AI features',
    `Some features of {{app_name}} send content you submit to third-party AI providers, named above, to generate a response. Do not submit information you do not want processed this way. How an AI provider handles that content is described in its own privacy policy.`,
    { when: { is: { ai_features: true } } }),
  clause('privacy', 'automated', 59, 'Automated decisions',
    `We do not make decisions about you based solely on automated processing that have legal or similarly significant effects.`,
    { when: EU_UK_BR, satisfies: ['gdpr-13-2f'] }),
  clause('privacy', 'transfers', 60, 'International transfers',
    `Our service providers may process data in countries other than your own, including the United States. Where the law requires safeguards for such transfers, we rely on mechanisms such as adequacy decisions or standard contractual clauses (in the UK, the International Data Transfer Agreement or the UK Addendum). You can contact us for more information about the safeguards in place.`,
    { when: { regions: ['eu', 'uk', 'br', 'au'] }, satisfies: ['gdpr-13-1f', 'uk-gdpr-transfers', 'lgpd-33-transfers', 'au-app1-overseas'] }),
  clause('privacy', 'retention', 70, 'How long we keep information',
    `We keep personal data {{retention}}.`,
    { satisfies: ['privacy-core-retention', 'gdpr-13-2a', 'apple-5-1-1-policy', 'lgpd-9-purpose'] }),
  clause('privacy', 'security', 75, 'How we protect information',
    `We use technical and organisational measures to protect personal data, including encryption in transit and access controls. No system is completely secure, so we cannot guarantee absolute security.`,
    { satisfies: ['privacy-core-security'] }),
  clause('privacy', 'rights', 80, 'Your choices',
    `You can ask us at any time to access, correct or delete the personal data we hold about you, by emailing {{contact_email}}. We may need to verify your identity first.`,
    { satisfies: ['privacy-core-rights', 'pipeda-4-9-access', 'au-app1-access'] }),
  clause('privacy', 'account-deletion', 82, 'Deleting your account',
    `You can delete your account at any time from within {{app_name}} or by emailing {{contact_email}}. When you do, we delete or anonymise your personal data as described under "How long we keep information", except where the law requires us to keep it.`,
    { when: { has: { data_collected: ['account'] } }, satisfies: ['apple-5-1-1-deletion'] }),
  clause('privacy', 'rights-eu', 84, 'Your data protection rights',
    `Depending on where you live, you have the right to:

- access the personal data we hold about you and receive a copy;
- have inaccurate data corrected;
- have your data erased;
- restrict or object to our processing;
- receive your data in a portable format; and
- withdraw consent at any time, without affecting processing that took place before you withdrew it.

To use any of these rights, email {{contact_email}}.`,
    { when: EU_UK_BR, satisfies: ['gdpr-13-2b', 'gdpr-13-2c', 'lgpd-18-rights'] }),
  clause('privacy', 'complaint-eu', 85, 'Complaints (EU)',
    `You have the right to lodge a complaint with the data protection supervisory authority in the EU country where you live, work or where you believe an infringement took place.`,
    { when: { regions: ['eu'] }, satisfies: ['gdpr-13-2d'] }),
  clause('privacy', 'complaint-uk', 85, 'Complaints (UK)',
    `If you are in the UK, you have the right to complain to the Information Commissioner's Office (ICO) at ico.org.uk. We would appreciate the chance to resolve your concern first.`,
    { when: { regions: ['uk'] }, satisfies: ['uk-gdpr-complaint-ico'] }),
  clause('privacy', 'california', 86, 'California privacy rights',
    `If you are a California resident, you have the right to know what personal information we collect, use, disclose, sell or share; to delete it; to correct inaccurate information; to opt out of the sale or sharing of your personal information; to limit the use of sensitive personal information; and not to be treated differently for exercising these rights.

To make a request, email {{contact_email}}. We will verify your identity before responding. You may use an authorised agent to make a request for you.`,
    { when: { regions: ['us-ca'] }, satisfies: ['ccpa-rights', 'ccpa-how-to-submit'] }),
  clause('privacy', 'us-states', 87, 'Privacy rights in other US states',
    `Depending on the state where you live, you may have the right to access, correct, delete and obtain a copy of your personal data, and to opt out of targeted advertising, the sale of personal data and profiling. To make a request, email {{contact_email}}.

If we decline your request, you can appeal by replying to our decision or emailing {{contact_email}} with "Appeal" in the subject. We will respond to appeals within the time the law requires.`,
    { when: { regions: ['us-other'] }, satisfies: ['us-states-rights', 'us-states-appeal'] }),
  clause('privacy', 'canada', 88, 'Consent (Canada)',
    `By using {{app_name}} you consent to the collection, use and disclosure of your personal information as described in this policy. You may withdraw your consent at any time, subject to legal or contractual restrictions and reasonable notice, by emailing {{contact_email}}. Withdrawing consent may mean we can no longer provide some features.`,
    { when: { regions: ['ca'] }, satisfies: ['pipeda-4-3-consent'] }),
  clause('privacy', 'australia', 89, 'Access, correction and complaints (Australia)',
    `If you are in Australia, you can ask to access or correct your personal information by emailing {{contact_email}}. If you have a complaint about how we handled your information, contact us at the same address. We will respond within a reasonable time. If you are not satisfied, you can contact the Office of the Australian Information Commissioner (OAIC).`,
    { when: { regions: ['au'] }, satisfies: ['au-app1-access', 'au-app1-complaints'] }),
  clause('privacy', 'children-general', 90, 'Children',
    `{{app_name}} is not directed to children, and we do not knowingly collect personal data from children under 16. If you believe a child has given us personal data, email {{contact_email}} and we will delete it.`,
    { when: { is: { children: 'none' } }, satisfies: ['privacy-core-children'] }),
  clause('privacy', 'children-teens', 90, 'Children and teenagers',
    `{{app_name}} is intended for people aged 13 and over. In the EU and UK, where local law sets the age at which a young person can consent to an online service higher than 13 (up to 16), we require authorisation from a parent or guardian below that age. If you believe a child younger than 13 has given us personal data, email {{contact_email}} and we will delete it.`,
    { when: { is: { children: 'teens' } }, satisfies: ['privacy-core-children', 'gdpr-8'] }),
  clause('privacy', 'children-kids', 90, "Children's privacy",
    `{{app_name}} is directed to children under 13. We collect personal information from a child only after obtaining verifiable consent from a parent or guardian, using methods the law accepts, and only the information described above, which we use only to provide {{app_name}}.

Parents can review the personal information we hold about their child, ask us to delete it, and refuse any further collection or use, at any time by emailing {{contact_email}}.`,
    { when: { is: { children: 'kids' } }, satisfies: ['privacy-core-children', 'coppa-312-4-notice', 'coppa-312-5-consent', 'coppa-312-6-parent-rights'] }),
  clause('privacy', 'cookies', 92, 'Cookies and similar technologies',
    `Our website and apps may use cookies and similar technologies. See our Cookie Policy, if we publish one, for what we use and how to manage your choices.`,
    { when: { anyOf: [{ has: { platforms: ['web'] } }, { has: { data_collected: ['analytics'] } }] } }),
  clause('privacy', 'changes', 95, 'Changes to this policy',
    `We may update this policy from time to time. We review it at least once a year, and when we make material changes we will tell you in {{app_name}} or by email. The date at the top shows when it was last updated.`,
    { satisfies: ['privacy-core-changes', 'ccpa-update-12m'] }),
  clause('privacy', 'contact', 99, 'Contact us',
    `Questions about this policy or your data? Email {{contact_email}}{{contact_postal}}.`,
    { satisfies: ['privacy-core-contact', 'pipeda-4-8-openness'] })
]

const terms: LegalClause[] = [
  clause('terms', 'intro', 10, 'Agreement to these terms',
    `These terms govern your use of {{app_name}}, operated by {{operator}} ("we", "us"). By creating an account or using {{app_name}} you agree to them. If you do not agree, do not use it. We have written these terms in plain language; if something is unclear, email {{contact_email}}.`,
    { satisfies: ['tos-acceptance', 'eu-ucd-plain'] }),
  clause('terms', 'accounts', 20, 'Eligibility and your account',
    `You must be at least {{min_age}} years old to use {{app_name}}. Keep your login details secure; you are responsible for activity on your account. Tell us at {{contact_email}} if you think someone else has used it.`,
    { satisfies: ['tos-accounts'] }),
  clause('terms', 'licence', 30, 'Our service and your licence',
    `{{app_name}}, including its software, design and content, belongs to us or our licensors. While you follow these terms, we give you a personal, non-exclusive, non-transferable, revocable licence to use it. You may not copy, modify, reverse engineer or resell it, except where the law allows.`,
    { satisfies: ['tos-ip'] }),
  clause('terms', 'acceptable-use', 40, 'Acceptable use',
    `You agree not to:

- break the law or infringe anyone's rights using {{app_name}};
- upload malware or try to disrupt, probe or gain unauthorised access to our systems;
- scrape or automate use of {{app_name}} in ways we have not allowed;
- harass or harm others, or use {{app_name}} to send spam; or
- help anyone else do any of these.`,
    { satisfies: ['tos-acceptable-use'] }),
  clause('terms', 'user-content', 45, 'Your content',
    `You keep ownership of the content you create or upload. You give us a worldwide, non-exclusive licence to host, store and display it only as needed to run {{app_name}} for you. You are responsible for your content, and we may remove content that breaks these terms.`,
    { when: { has: { data_collected: ['user_content'] } } }),
  clause('terms', 'subscriptions', 50, 'Subscriptions and payments',
    `Some features need a paid subscription. The price, length and renewal terms are shown before you subscribe. Subscriptions renew automatically until cancelled. You can cancel at any time in the settings of the store or payment service you subscribed through, and cancellation takes effect at the end of the current billing period. Our Refund Policy explains when refunds are available.`,
    { when: { is: { subscriptions: true } }, satisfies: ['tos-subscriptions', 'apple-3-1-2-subscriptions'] }),
  clause('terms', 'withdrawal-eu', 55, 'Right of withdrawal (EU consumers)',
    `If you are a consumer in the EU, you normally have 14 days to withdraw from a purchase. When you ask us to start providing digital content or a digital service straight away, you agree that you lose the right of withdrawal once it has been fully provided, or, for a service, once it has started, if you gave your express consent and acknowledged this.`,
    { when: { regions: ['eu'] }, satisfies: ['eu-crd-withdrawal'] }),
  clause('terms', 'termination', 60, 'Ending this agreement',
    `You can stop using {{app_name}} and delete your account at any time. We may suspend or end your access if you break these terms or if we must by law. Sections that by their nature should continue, such as ownership, disclaimers and liability, survive termination.`,
    { satisfies: ['tos-termination'] }),
  clause('terms', 'disclaimer', 70, 'Disclaimer',
    `To the extent the law allows, {{app_name}} is provided "as is" and "as available", without warranties of any kind, including fitness for a particular purpose. We do not promise it will be uninterrupted or error-free. Nothing in these terms limits rights you have as a consumer that cannot be limited by law.`,
    { satisfies: ['tos-disclaimer'] }),
  clause('terms', 'liability', 80, 'Limit of liability',
    `To the extent the law allows, we are not liable for indirect or consequential losses, or for loss of profits, data or goodwill, and our total liability for any claim is limited to the greater of the amount you paid us in the 12 months before the claim and 50 US dollars. Nothing in these terms excludes liability that cannot be excluded by law, including for death or personal injury caused by negligence or for fraud.`,
    { satisfies: ['tos-liability'] }),
  clause('terms', 'governing-law', 85, 'Governing law',
    `These terms are governed by the laws of {{governing_law}}. Disputes will be decided by the courts of that jurisdiction, but if you are a consumer you may also have the right to bring a claim in the courts of the country where you live.`,
    { satisfies: ['tos-governing-law'] }),
  clause('terms', 'changes', 90, 'Changes to these terms',
    `We may update these terms. If a change is material, we will tell you in {{app_name}} or by email before it takes effect. If you keep using {{app_name}} after that, you accept the new terms.`,
    { satisfies: ['tos-changes'] }),
  clause('terms', 'contact', 99, 'Contact us', `Questions about these terms? Email {{contact_email}}{{contact_postal}}.`, { satisfies: ['tos-contact'] })
]

const cookies: LegalClause[] = [
  clause('cookies', 'what', 10, 'What cookies are',
    `Cookies are small files a website stores on your device. We use the word to include similar technologies, such as local storage and SDK identifiers, that store or read information on your device. {{app_name}} is operated by {{operator}}.`,
    { satisfies: ['cookies-what'] }),
  clause('cookies', 'categories', 20, 'What we use and why',
    `We use these kinds of cookies:

{{cookie_list}}`,
    { satisfies: ['cookies-categories', 'eprivacy-5-3', 'uk-pecr-6'] }),
  clause('cookies', 'consent', 30, 'Your consent',
    `We only set cookies that are not strictly necessary after you have agreed to them. You can choose which categories to allow and change your mind at any time.`,
    { when: { regions: ['eu', 'uk'] }, satisfies: ['eprivacy-5-3', 'uk-pecr-6'] }),
  clause('cookies', 'manage', 40, 'Managing cookies',
    `You can change your cookie choices in {{app_name}} where we offer a setting, and you can block or delete cookies in your browser settings. Blocking essential cookies may stop parts of {{app_name}} from working.`,
    { satisfies: ['cookies-manage'] }),
  clause('cookies', 'contact', 99, 'Contact us', `Questions about cookies? Email {{contact_email}}. Our Privacy Policy explains how we handle personal data more generally.`, { satisfies: ['cookies-contact'] })
]

const refund: LegalClause[] = [
  clause('refund', 'store', 10, 'Purchases through the App Store or Google Play',
    `If you bought through the App Store or Google Play, the store handles the payment and any refund. Request one through Apple at reportaproblem.apple.com, or through Google Play's refund help. We cannot refund store purchases ourselves.`,
    { when: { is: { refund_via: 'store' } }, satisfies: ['refund-store', 'refund-eligibility', 'refund-how'] }),
  clause('refund', 'eligibility', 10, 'When you can get a refund',
    `If you bought {{app_name}} directly from us, you can ask for a full refund within {{refund_window_days}} days of the purchase, for any reason.`,
    { when: { is: { refund_via: 'direct' } }, satisfies: ['refund-eligibility'] }),
  clause('refund', 'how', 20, 'How to ask',
    `Email {{contact_email}} from the address you used to buy, with your order details. We will confirm by email.`,
    { when: { is: { refund_via: 'direct' } }, satisfies: ['refund-how'] }),
  clause('refund', 'timing', 25, 'How long it takes',
    `Approved refunds go back to the original payment method. How long it then takes to appear depends on your bank, card issuer or the store, and is often 5 to 10 business days.`,
    { satisfies: ['refund-timing'] }),
  clause('refund', 'exceptions', 30, 'What is not refundable',
    `We may refuse a refund where we find abuse or fraud, such as repeated refund requests, or where the law allows us to. Nothing here limits any refund right you have by law.`,
    { satisfies: ['refund-exceptions'] }),
  clause('refund', 'subscriptions', 40, 'Subscriptions',
    `You can cancel a subscription at any time. Cancelling stops future charges; unless the law or this policy says otherwise, we do not refund the part of a billing period that has already started.`,
    { when: { is: { subscriptions: true } } }),
  clause('refund', 'withdrawal-eu', 45, 'EU right of withdrawal',
    `If you are a consumer in the EU, you normally have 14 days to withdraw from a purchase. You lose that right for digital content or a digital service once it has been provided, or, for a service, once it has started, if you asked for it to start straight away, gave your express consent and acknowledged this.`,
    { when: { regions: ['eu'] }, satisfies: ['eu-crd-withdrawal'] }),
  clause('refund', 'contact', 99, 'Contact us', `Questions about refunds? Email {{contact_email}}.`, { satisfies: ['refund-how'] })
]

export const LEGAL_CLAUSES: LegalClause[] = [...privacy, ...terms, ...cookies, ...refund]

export function clausesFor(type: LegalDocType): LegalClause[] {
  return LEGAL_CLAUSES.filter(c => c.docType === type).sort((a, b) => a.order - b.order)
}
