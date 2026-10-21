import { matchLocale } from '../locales'

// The few words the hosted legal page adds around a document's own text. The document
// is in its own language; this keeps the frame around it in the same one.

export type LegalLabels = { effective: string, version: string, contents: string, inShort: string, legal: string, empty: string, languages: string }

const EN: LegalLabels = { effective: 'Effective {date}', version: 'Version {n}', contents: 'Contents', inShort: 'In short', legal: 'Legal', empty: 'Nothing published yet.', languages: 'Languages' }

const LABELS: Record<string, LegalLabels> = {
  en: EN,
  es: { effective: 'En vigor desde el {date}', version: 'Versión {n}', contents: 'Contenido', inShort: 'En resumen', legal: 'Legal', empty: 'Todavía no hay nada publicado.', languages: 'Idiomas' },
  ca: { effective: 'En vigor des del {date}', version: 'Versió {n}', contents: 'Contingut', inShort: 'En resum', legal: 'Legal', empty: 'Encara no hi ha res publicat.', languages: 'Idiomes' },
  fr: { effective: 'En vigueur le {date}', version: 'Version {n}', contents: 'Sommaire', inShort: 'En bref', legal: 'Mentions légales', empty: 'Rien n’est encore publié.', languages: 'Langues' },
  de: { effective: 'Gültig ab {date}', version: 'Version {n}', contents: 'Inhalt', inShort: 'Kurz gesagt', legal: 'Rechtliches', empty: 'Noch nichts veröffentlicht.', languages: 'Sprachen' },
  it: { effective: 'In vigore dal {date}', version: 'Versione {n}', contents: 'Indice', inShort: 'In breve', legal: 'Note legali', empty: 'Nulla di pubblicato per ora.', languages: 'Lingue' },
  pt: { effective: 'Em vigor desde {date}', version: 'Versão {n}', contents: 'Conteúdo', inShort: 'Em resumo', legal: 'Legal', empty: 'Nada publicado ainda.', languages: 'Idiomas' },
  ja: { effective: '施行日 {date}', version: 'バージョン {n}', contents: '目次', inShort: '概要', legal: '法的情報', empty: 'まだ公開されているものはありません。', languages: '言語' },
  ko: { effective: '시행일 {date}', version: '버전 {n}', contents: '목차', inShort: '요약', legal: '법적 고지', empty: '아직 게시된 문서가 없습니다.', languages: '언어' },
  zh: { effective: '生效日期 {date}', version: '版本 {n}', contents: '目录', inShort: '摘要', legal: '法律文件', empty: '暂无已发布的内容。', languages: '语言' }
}

/** The labels for a document's language (its base language when the region has none, English otherwise). */
export function legalLabels(locale: string | undefined): LegalLabels {
  const have = matchLocale([locale], Object.keys(LABELS))
  return LABELS[have || 'en'] || EN
}

export const fillLabel = (template: string, values: Record<string, string | number>): string => template.replace(/\{(\w+)\}/g, (full, key: string) => (key in values ? String(values[key]) : full))
