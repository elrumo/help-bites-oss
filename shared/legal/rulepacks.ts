import type { LegalRulepack } from './types'

// Curated requirement checklists. They ground the AI (it is handed the
// applicable ones and may cite only those ids) and drive the deterministic
// coverage check. Summaries are paraphrases with a citation, never statute
// text. `lastReviewed` is the date a person last compared the pack with its
// source (null until one has); set it, and bump `version`, only when you have.
// These are working checklists, not legal advice: have a lawyer review them.

// null = no person has checked this pack against its sources yet. Set an ISO date once one has.
const REVIEWED: string | null = null

export const LEGAL_RULEPACKS: LegalRulepack[] = [
  {
    id: 'privacy-core', name: 'Privacy policy basics', kind: 'best-practice', version: '1', sourceUrl: 'https://www.oecd.org/digital/privacy/', lastReviewed: REVIEWED,
    appliesWhen: {},
    requirements: [
      { id: 'privacy-core-who', docTypes: ['privacy'], summary: 'Say who operates the service and how to reach them.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-collect', docTypes: ['privacy'], summary: 'List the kinds of personal data collected.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-use', docTypes: ['privacy'], summary: 'Explain what the data is used for.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-sharing', docTypes: ['privacy'], summary: 'Say who the data is shared with.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-retention', docTypes: ['privacy'], summary: 'Say how long data is kept.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-security', docTypes: ['privacy'], summary: 'Describe, in general terms, how data is protected.', citation: 'Common to every privacy regime', severity: 'recommended' },
      { id: 'privacy-core-rights', docTypes: ['privacy'], summary: 'Tell people how to access, correct or delete their data.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-children', docTypes: ['privacy'], summary: 'State whether the service is meant for children.', citation: 'Common to every privacy regime', severity: 'required' },
      { id: 'privacy-core-changes', docTypes: ['privacy'], summary: 'Explain how changes to the policy are announced.', citation: 'Common to every privacy regime', severity: 'recommended' },
      { id: 'privacy-core-contact', docTypes: ['privacy'], summary: 'Give a contact for privacy questions.', citation: 'Common to every privacy regime', severity: 'required' }
    ]
  },
  {
    id: 'gdpr', name: 'EU General Data Protection Regulation', kind: 'law', version: '1', sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['eu'] },
    requirements: [
      { id: 'gdpr-13-1a', docTypes: ['privacy'], summary: 'Identify the controller and give its contact details.', citation: 'GDPR Art. 13(1)(a)', severity: 'required' },
      { id: 'gdpr-13-1b', docTypes: ['privacy'], summary: 'Give the data protection officer\'s contact where one is appointed.', citation: 'GDPR Art. 13(1)(b)', severity: 'recommended' },
      { id: 'gdpr-13-1c', docTypes: ['privacy'], summary: 'State each purpose of processing and its legal basis.', citation: 'GDPR Art. 13(1)(c)', severity: 'required' },
      { id: 'gdpr-13-1d', docTypes: ['privacy'], summary: 'Name the legitimate interests relied on, where legitimate interests is a basis.', citation: 'GDPR Art. 13(1)(d)', severity: 'required' },
      { id: 'gdpr-13-1e', docTypes: ['privacy'], summary: 'Name the recipients or categories of recipients.', citation: 'GDPR Art. 13(1)(e)', severity: 'required' },
      { id: 'gdpr-13-1f', docTypes: ['privacy'], summary: 'Disclose transfers outside the EEA and the safeguards used.', citation: 'GDPR Art. 13(1)(f)', severity: 'required' },
      { id: 'gdpr-13-2a', docTypes: ['privacy'], summary: 'State the retention period, or the criteria used to set it.', citation: 'GDPR Art. 13(2)(a)', severity: 'required' },
      { id: 'gdpr-13-2b', docTypes: ['privacy'], summary: 'List the rights of access, rectification, erasure, restriction, objection and portability.', citation: 'GDPR Art. 13(2)(b)', severity: 'required' },
      { id: 'gdpr-13-2c', docTypes: ['privacy'], summary: 'Say consent can be withdrawn at any time, where consent is a basis.', citation: 'GDPR Art. 13(2)(c)', severity: 'required' },
      { id: 'gdpr-13-2d', docTypes: ['privacy'], summary: 'Mention the right to complain to a supervisory authority.', citation: 'GDPR Art. 13(2)(d)', severity: 'required' },
      { id: 'gdpr-13-2e', docTypes: ['privacy'], summary: 'Say whether providing data is required and what follows if it is not.', citation: 'GDPR Art. 13(2)(e)', severity: 'required' },
      { id: 'gdpr-13-2f', docTypes: ['privacy'], summary: 'Disclose automated decision-making, including profiling, and its logic.', citation: 'GDPR Art. 13(2)(f)', severity: 'required' },
      { id: 'gdpr-8', docTypes: ['privacy'], summary: 'Address the age at which a child can consent to an online service, and parental authorisation below it.', citation: 'GDPR Art. 8', severity: 'required', appliesWhen: { is: { children: 'teens' } } }
    ]
  },
  {
    id: 'eprivacy', name: 'EU ePrivacy Directive (cookies)', kind: 'law', version: '1', sourceUrl: 'https://eur-lex.europa.eu/eli/dir/2002/58/oj', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['eu'] },
    requirements: [
      { id: 'eprivacy-5-3', docTypes: ['cookies'], summary: 'Get consent before storing or reading non-essential data on a device, and describe the purposes clearly.', citation: 'ePrivacy Directive Art. 5(3)', severity: 'required' }
    ]
  },
  {
    id: 'eu-consumer', name: 'EU consumer protection', kind: 'law', version: '1', sourceUrl: 'https://eur-lex.europa.eu/eli/dir/2011/83/oj', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['eu'] },
    requirements: [
      { id: 'eu-crd-withdrawal', docTypes: ['refund', 'terms'], summary: 'Tell consumers about the 14-day right of withdrawal, or that it is lost once digital content or service starts with their express consent.', citation: 'Directive 2011/83/EU Arts. 6(1)(h), 16(m)', severity: 'required' },
      { id: 'eu-ucd-plain', docTypes: ['terms'], summary: 'Write consumer terms in plain, intelligible language.', citation: 'Directive 93/13/EEC Art. 5', severity: 'required' }
    ]
  },
  {
    id: 'uk-gdpr', name: 'UK GDPR and PECR', kind: 'law', version: '1', sourceUrl: 'https://www.legislation.gov.uk/eur/2016/679/contents', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['uk'] },
    requirements: [
      { id: 'uk-gdpr-13', docTypes: ['privacy'], summary: 'Give the Article 13 information: controller, purposes and legal bases, recipients, retention, rights.', citation: 'UK GDPR Art. 13', severity: 'required' },
      { id: 'uk-gdpr-complaint-ico', docTypes: ['privacy'], summary: 'Mention the right to complain to the ICO.', citation: 'UK GDPR Art. 13(2)(d)', severity: 'required' },
      { id: 'uk-gdpr-transfers', docTypes: ['privacy'], summary: 'Disclose transfers outside the UK and the safeguards used.', citation: 'UK GDPR Art. 13(1)(f), Chapter V', severity: 'required' },
      { id: 'uk-pecr-6', docTypes: ['cookies'], summary: 'Get consent before using non-essential cookies, and explain them clearly.', citation: 'PECR reg. 6', severity: 'required' }
    ]
  },
  {
    id: 'ccpa', name: 'California Consumer Privacy Act / CPRA', kind: 'law', version: '1', sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=CIV&division=3.&title=1.81.5.&part=4.&chapter=&article=', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['us-ca'] },
    requirements: [
      { id: 'ccpa-categories-collected', docTypes: ['privacy'], summary: 'List the categories of personal information collected in the last 12 months.', citation: 'Cal. Civ. Code § 1798.130(a)(5)', severity: 'required' },
      { id: 'ccpa-sources-purposes', docTypes: ['privacy'], summary: 'Give the sources of the information and the purposes it is collected and used for.', citation: 'Cal. Civ. Code §§ 1798.110, 1798.130(a)(5)', severity: 'required' },
      { id: 'ccpa-disclosed-categories', docTypes: ['privacy'], summary: 'List the categories disclosed for a business purpose, and sold or shared, with the categories of recipients.', citation: 'Cal. Civ. Code § 1798.130(a)(5)', severity: 'required' },
      { id: 'ccpa-rights', docTypes: ['privacy'], summary: 'Describe the rights to know, delete, correct, opt out of sale or sharing, limit sensitive data use, and not be discriminated against.', citation: 'Cal. Civ. Code §§ 1798.100–1798.125', severity: 'required' },
      { id: 'ccpa-how-to-submit', docTypes: ['privacy'], summary: 'Explain how to submit a request.', citation: 'Cal. Civ. Code § 1798.130(a)(1)', severity: 'required' },
      { id: 'ccpa-opt-out', docTypes: ['privacy'], summary: 'Offer an opt-out of sale or sharing and honour opt-out preference signals, if personal data is sold or shared.', citation: 'Cal. Civ. Code §§ 1798.120, 1798.135', severity: 'required', appliesWhen: { is: { sells_or_shares_data: true } } },
      { id: 'ccpa-update-12m', docTypes: ['privacy'], summary: 'Update the policy at least every 12 months.', citation: 'Cal. Civ. Code § 1798.130(a)(5)', severity: 'recommended' }
    ]
  },
  {
    id: 'us-states', name: 'US state privacy laws (VA, CO, CT, TX and similar)', kind: 'law', version: '1', sourceUrl: 'https://iapp.org/resources/article/us-state-privacy-legislation-tracker/', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['us-other'] },
    requirements: [
      { id: 'us-states-notice', docTypes: ['privacy'], summary: 'Give a privacy notice listing categories processed, purposes, categories shared with third parties and who they are shared with.', citation: 'e.g. Va. Code § 59.1-578(C); Colo. Rev. Stat. § 6-1-1308; Conn. Gen. Stat. § 42-520', severity: 'required' },
      { id: 'us-states-rights', docTypes: ['privacy'], summary: 'Explain how to exercise rights of access, correction, deletion, portability and opt-out of targeted advertising, sale and profiling.', citation: 'e.g. Va. Code § 59.1-577; Colo. Rev. Stat. § 6-1-1306', severity: 'required' },
      { id: 'us-states-appeal', docTypes: ['privacy'], summary: 'Describe how to appeal a refused request.', citation: 'e.g. Va. Code § 59.1-577(C); Colo. Rev. Stat. § 6-1-1306(3)', severity: 'required' }
    ]
  },
  {
    id: 'coppa', name: 'US Children\'s Online Privacy Protection Rule', kind: 'law', version: '1', sourceUrl: 'https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312', lastReviewed: REVIEWED,
    appliesWhen: { is: { children: 'kids' } },
    requirements: [
      { id: 'coppa-312-4-notice', docTypes: ['privacy'], summary: 'Post a notice naming the operator, the information collected from children, how it is used and disclosed.', citation: '16 CFR § 312.4', severity: 'required' },
      { id: 'coppa-312-5-consent', docTypes: ['privacy'], summary: 'Explain how verifiable parental consent is obtained before collecting children\'s data.', citation: '16 CFR § 312.5', severity: 'required' },
      { id: 'coppa-312-6-parent-rights', docTypes: ['privacy'], summary: 'Tell parents they may review, delete and stop further collection of their child\'s data.', citation: '16 CFR § 312.6', severity: 'required' }
    ]
  },
  {
    id: 'lgpd', name: 'Brazil General Data Protection Law (LGPD)', kind: 'law', version: '1', sourceUrl: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['br'] },
    requirements: [
      { id: 'lgpd-9-purpose', docTypes: ['privacy'], summary: 'State the specific purpose, form and duration of processing.', citation: 'LGPD Art. 9', severity: 'required' },
      { id: 'lgpd-9-controller', docTypes: ['privacy'], summary: 'Identify the controller and give its contact.', citation: 'LGPD Art. 9', severity: 'required' },
      { id: 'lgpd-9-sharing', docTypes: ['privacy'], summary: 'Disclose shared use of data and with whom.', citation: 'LGPD Art. 9', severity: 'required' },
      { id: 'lgpd-18-rights', docTypes: ['privacy'], summary: 'List the data subject\'s rights.', citation: 'LGPD Art. 18', severity: 'required' },
      { id: 'lgpd-41-dpo', docTypes: ['privacy'], summary: 'Publish the identity and contact of the data protection officer (encarregado).', citation: 'LGPD Art. 41', severity: 'required' },
      { id: 'lgpd-33-transfers', docTypes: ['privacy'], summary: 'Disclose international transfers and their basis.', citation: 'LGPD Art. 33', severity: 'required' }
    ]
  },
  {
    id: 'pipeda', name: 'Canada PIPEDA', kind: 'law', version: '1', sourceUrl: 'https://laws-lois.justice.gc.ca/eng/acts/p-8.6/', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['ca'] },
    requirements: [
      { id: 'pipeda-4-3-consent', docTypes: ['privacy'], summary: 'Explain what consent is sought for and that it may be withdrawn.', citation: 'PIPEDA Sched. 1, Principle 4.3', severity: 'required' },
      { id: 'pipeda-4-8-openness', docTypes: ['privacy'], summary: 'Make policies easy to find: who is accountable, what is held and why, how to ask for access.', citation: 'PIPEDA Sched. 1, Principle 4.8', severity: 'required' },
      { id: 'pipeda-4-9-access', docTypes: ['privacy'], summary: 'Explain how individuals can access and correct their information.', citation: 'PIPEDA Sched. 1, Principle 4.9', severity: 'required' }
    ]
  },
  {
    id: 'au-privacy', name: 'Australian Privacy Act (APP 1)', kind: 'law', version: '1', sourceUrl: 'https://www.oaic.gov.au/privacy/australian-privacy-principles', lastReviewed: REVIEWED,
    appliesWhen: { regions: ['au'] },
    requirements: [
      { id: 'au-app1-kinds', docTypes: ['privacy'], summary: 'List the kinds of personal information collected and held, and how.', citation: 'Privacy Act 1988 APP 1.4(a)–(b)', severity: 'required' },
      { id: 'au-app1-purposes', docTypes: ['privacy'], summary: 'State the purposes for which information is collected, held, used and disclosed.', citation: 'Privacy Act 1988 APP 1.4(c)', severity: 'required' },
      { id: 'au-app1-access', docTypes: ['privacy'], summary: 'Explain how to access and correct information.', citation: 'Privacy Act 1988 APP 1.4(d), APPs 12–13', severity: 'required' },
      { id: 'au-app1-complaints', docTypes: ['privacy'], summary: 'Explain how to complain and how complaints are handled.', citation: 'Privacy Act 1988 APP 1.4(e)', severity: 'required' },
      { id: 'au-app1-overseas', docTypes: ['privacy'], summary: 'Say whether information is disclosed overseas and to which countries.', citation: 'Privacy Act 1988 APP 1.4(f)–(g), APP 8', severity: 'required' }
    ]
  },
  {
    id: 'apple-app-store', name: 'Apple App Store Review Guidelines', kind: 'platform', version: '1', sourceUrl: 'https://developer.apple.com/app-store/review/guidelines/', lastReviewed: REVIEWED,
    appliesWhen: { has: { platforms: ['ios'] } },
    requirements: [
      { id: 'apple-5-1-1-policy', docTypes: ['privacy'], summary: 'Privacy policy states what data is collected, how, all uses, third-party sharing and retention.', citation: 'App Review Guideline 5.1.1(i)', severity: 'required' },
      { id: 'apple-5-1-1-deletion', docTypes: ['privacy'], summary: 'Apps that create accounts must let people delete them; say how.', citation: 'App Review Guideline 5.1.1(v)', severity: 'required', appliesWhen: { has: { data_collected: ['account'] } } },
      { id: 'apple-3-1-2-subscriptions', docTypes: ['terms'], summary: 'Describe subscription price, length and renewal clearly and link the terms of use.', citation: 'App Review Guideline 3.1.2(a)', severity: 'required', appliesWhen: { is: { subscriptions: true } } }
    ]
  },
  {
    id: 'google-play', name: 'Google Play User Data policy', kind: 'platform', version: '1', sourceUrl: 'https://support.google.com/googleplay/android-developer/answer/10144311', lastReviewed: REVIEWED,
    appliesWhen: { has: { platforms: ['android'] } },
    requirements: [
      { id: 'gplay-user-data', docTypes: ['privacy'], summary: 'Privacy policy discloses how user data is accessed, collected, used and shared, and matches the Data safety form.', citation: 'Google Play User Data policy', severity: 'required' }
    ]
  },
  {
    id: 'terms-core', name: 'Terms of service basics', kind: 'best-practice', version: '1', sourceUrl: 'https://www.ftc.gov/business-guidance', lastReviewed: REVIEWED,
    appliesWhen: {},
    requirements: [
      { id: 'tos-acceptance', docTypes: ['terms'], summary: 'Say that using the service means accepting the terms.', citation: 'Contract formation, common practice', severity: 'required' },
      { id: 'tos-accounts', docTypes: ['terms'], summary: 'Set eligibility, minimum age and account responsibilities.', citation: 'Common practice', severity: 'required' },
      { id: 'tos-acceptable-use', docTypes: ['terms'], summary: 'Say what users may not do.', citation: 'Common practice', severity: 'required' },
      { id: 'tos-ip', docTypes: ['terms'], summary: 'Say who owns the service and what licence users get.', citation: 'Common practice', severity: 'required' },
      { id: 'tos-subscriptions', docTypes: ['terms'], summary: 'Explain prices, billing, renewal and cancellation.', citation: 'Consumer protection law, common practice', severity: 'required', appliesWhen: { is: { subscriptions: true } } },
      { id: 'tos-termination', docTypes: ['terms'], summary: 'Explain how either side can end the agreement.', citation: 'Common practice', severity: 'required' },
      { id: 'tos-disclaimer', docTypes: ['terms'], summary: 'Disclaim warranties to the extent the law allows.', citation: 'Common practice', severity: 'recommended' },
      { id: 'tos-liability', docTypes: ['terms'], summary: 'Limit liability to the extent the law allows.', citation: 'Common practice', severity: 'recommended' },
      { id: 'tos-governing-law', docTypes: ['terms'], summary: 'Name the governing law.', citation: 'Common practice', severity: 'required' },
      { id: 'tos-changes', docTypes: ['terms'], summary: 'Say how changes to the terms are announced.', citation: 'Common practice', severity: 'required' },
      { id: 'tos-contact', docTypes: ['terms'], summary: 'Give a contact for questions.', citation: 'Common practice', severity: 'required' }
    ]
  },
  {
    id: 'cookies-core', name: 'Cookie policy basics', kind: 'best-practice', version: '1', sourceUrl: 'https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-cookies-and-similar-technologies/', lastReviewed: REVIEWED,
    appliesWhen: {},
    requirements: [
      { id: 'cookies-what', docTypes: ['cookies'], summary: 'Explain what cookies and similar technologies are.', citation: 'Common practice', severity: 'required' },
      { id: 'cookies-categories', docTypes: ['cookies'], summary: 'List the categories used and their purposes.', citation: 'Common practice', severity: 'required' },
      { id: 'cookies-manage', docTypes: ['cookies'], summary: 'Explain how to change or withdraw cookie choices.', citation: 'Common practice', severity: 'required' },
      { id: 'cookies-contact', docTypes: ['cookies'], summary: 'Give a contact for cookie questions.', citation: 'Common practice', severity: 'recommended' }
    ]
  },
  {
    id: 'refund-core', name: 'Refund policy basics', kind: 'best-practice', version: '1', sourceUrl: 'https://www.ftc.gov/business-guidance', lastReviewed: REVIEWED,
    appliesWhen: {},
    requirements: [
      { id: 'refund-eligibility', docTypes: ['refund'], summary: 'State when a refund is available.', citation: 'Common practice', severity: 'required' },
      { id: 'refund-how', docTypes: ['refund'], summary: 'Explain how to ask for one.', citation: 'Common practice', severity: 'required' },
      { id: 'refund-timing', docTypes: ['refund'], summary: 'Say how long a refund takes.', citation: 'Common practice', severity: 'recommended' },
      { id: 'refund-exceptions', docTypes: ['refund'], summary: 'List anything that is not refundable.', citation: 'Common practice', severity: 'recommended' },
      { id: 'refund-store', docTypes: ['refund'], summary: 'Point store purchases to the store\'s own refund process.', citation: 'Platform terms', severity: 'required', appliesWhen: { is: { refund_via: 'store' } } }
    ]
  }
]

export function getRulepack(id: string): LegalRulepack | undefined {
  return LEGAL_RULEPACKS.find(pack => pack.id === id)
}
