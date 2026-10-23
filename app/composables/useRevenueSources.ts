import { revenueSource } from '#shared/revenue'

/** A revenue source's name: the product's own, except for "Custom API", which is ours to translate. */
export function useRevenueSourceName() {
  const { t } = useI18n()
  return (id: string) => (id === 'custom' ? t('projectTools.revenue.sources.custom.name') : revenueSource(id)?.name || id)
}
