<template>
  <div class="rounded-xl border p-4 transition-colors" :class="plan.highlighted ? 'border-primary/50' : 'border-default'">
    <div class="flex items-center gap-1">
      <button type="button" class="mr-auto flex min-w-0 items-center gap-2 text-left" :aria-expanded="open" @click="open = !open">
        <UIcon :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4 shrink-0 text-muted" />
        <span class="truncate text-[13px] font-medium text-highlighted">{{ plan.name || product?.name || $t('projectTools.pricing.planN', { n: index + 1 }) }}</span>
        <span class="truncate font-mono text-xs text-dimmed">{{ plan.key }}</span>
        <UBadge v-if="plan.badge" :label="plan.badge" size="sm" variant="soft" />
      </button>
      <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="index === 0" :aria-label="$t('projectTools.pricing.moveUp')" @click="emit('move', -1)" />
      <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="index === count - 1" :aria-label="$t('projectTools.pricing.moveDown')" @click="emit('move', 1)" />
      <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :disabled="count === 1" :aria-label="$t('projectTools.pricing.removePlan')" @click="emit('remove')" />
    </div>

    <div v-if="open" class="mt-4 space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="$t('projectTools.pricing.planName')" :help="!plan.name && product ? $t('projectTools.pricing.fromStripe', { value: product.name }) : undefined">
          <UInput v-model="plan.name" :maxlength="PRICING_LIMITS.name" :placeholder="product?.name" class="w-full font-medium" @update:model-value="followKey" />
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.planKey')" :help="$t('projectTools.pricing.planKeyHint')" :error="PRICING_KEY.test(plan.key) ? undefined : $t('projectTools.pricing.keyInvalid')">
          <UInput v-model="plan.key" class="w-full font-mono" @update:model-value="keyEdited = true" />
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.description')" class="sm:col-span-2">
          <UInput v-model="plan.description" :maxlength="PRICING_LIMITS.description" :placeholder="product?.description" class="w-full" />
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.badge')">
          <UInput v-model="plan.badge" :maxlength="PRICING_LIMITS.badge" :placeholder="$t('projectTools.pricing.badgePlaceholder')" class="w-full" />
        </UFormField>
        <USwitch v-model="plan.highlighted" :label="$t('projectTools.pricing.highlighted')" class="self-end pb-1.5" />
      </div>

      <div class="space-y-3 rounded-lg bg-elevated/50 p-3">
        <UFormField :label="$t('projectTools.pricing.stripeProduct')" :help="stripe ? undefined : $t('projectTools.pricing.stripeProductOff')">
          <div class="flex flex-wrap items-center gap-2">
            <OptionalSelect v-model="plan.stripeProduct" :items="productItems" :none-label="$t('projectTools.pricing.noProduct')" :disabled="!stripe" class="min-w-56 flex-1" />
            <UButton v-if="product?.features.length" icon="i-lucide-list-plus" :label="$t('projectTools.pricing.importFeatures', { n: product.features.length })" size="xs" color="neutral" variant="soft" @click="emit('import-features', product.features)" />
          </div>
        </UFormField>
        <div class="grid gap-3">
          <div v-for="slot in PRICING_INTERVALS" :key="slot" class="grid items-end gap-2 sm:grid-cols-[6rem_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
            <span class="pb-2 text-xs font-medium text-muted">{{ $t(`projectTools.pricing.slots.${slot}`) }}</span>
            <UFormField :label="$t('projectTools.pricing.stripePrice')" size="sm">
              <USelect v-model="priceChoice[slot]" :items="priceItems(slot)" value-key="value" size="sm" :disabled="!stripe" class="w-full" />
            </UFormField>
            <UFormField :label="$t('projectTools.pricing.manualAmount', { currency: currency.toUpperCase() })" size="sm" :help="resolved[slot] && resolved[slot]!.source === 'stripe' ? $t('projectTools.pricing.stripeWins', { price: money(resolved[slot]!) }) : undefined">
              <UInput :model-value="plan.prices[slot].amount ?? ''" type="number" min="0" step="0.01" size="sm" class="w-full tabular-nums" @update:model-value="setAmount(slot, $event)" />
            </UFormField>
            <UFormField :label="$t('projectTools.pricing.appStoreProduct')" size="sm">
              <UInput v-model="plan.prices[slot].appStoreProduct" :maxlength="PRICING_LIMITS.product" placeholder="com.acme.pro" size="sm" class="w-full font-mono" />
            </UFormField>
          </div>
        </div>
        <div v-if="writtenSlots.length" class="space-y-2 border-t border-default pt-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="mr-auto text-xs font-medium text-muted">{{ $t('projectTools.pricing.otherCurrencies') }}</span>
            <UInput v-model="newCurrency" maxlength="3" size="xs" placeholder="EUR" class="w-20 font-mono uppercase" :aria-label="$t('projectTools.pricing.currencyCode')" @keydown.enter.prevent="addCurrency" />
            <UButton icon="i-lucide-plus" :label="$t('projectTools.pricing.addCurrency')" size="xs" color="neutral" variant="soft" :disabled="!canAddCurrency" @click="addCurrency" />
          </div>
          <div v-for="code in otherCurrencies" :key="code" class="grid items-end gap-2" :style="{ gridTemplateColumns: `3rem repeat(${writtenSlots.length}, minmax(0, 1fr)) auto` }">
            <span class="pb-2 font-mono text-xs uppercase text-muted">{{ code }}</span>
            <UFormField v-for="slot in writtenSlots" :key="slot" :label="$t(`projectTools.pricing.slots.${slot}`)" size="sm">
              <UInput :model-value="plan.prices[slot].amounts[code] ?? ''" type="number" min="0" step="0.01" size="sm" class="w-full tabular-nums" @update:model-value="setOtherAmount(slot, code, $event)" />
            </UFormField>
            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="mb-1" :aria-label="$t('projectTools.pricing.removeCurrency', { currency: code.toUpperCase() })" @click="removeCurrency(code)" />
          </div>
          <p class="text-[11px] text-dimmed">{{ $t('projectTools.pricing.otherCurrenciesHint') }}</p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <UFormField :label="$t('projectTools.pricing.customPrice')" :help="$t('projectTools.pricing.customPriceHint')">
          <UInput v-model="plan.customPrice" :maxlength="PRICING_LIMITS.custom" :placeholder="$t('projectTools.pricing.customPricePlaceholder')" class="w-full" />
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.priceNote')">
          <UInput v-model="plan.priceNote" :maxlength="PRICING_LIMITS.note" :placeholder="product?.unitLabel ? `per ${product.unitLabel}` : $t('projectTools.pricing.priceNotePlaceholder')" class="w-full" />
        </UFormField>
        <UFormField :label="$t('projectTools.pricing.trialDays')">
          <UInput v-model.number="plan.trialDays" type="number" min="0" :max="PRICING_LIMITS.trialDays" class="w-full tabular-nums" />
        </UFormField>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="$t('projectTools.pricing.button')" :help="$t(`projectTools.pricing.actionHints.${plan.action.type}`)">
          <USelect v-model="plan.action.type" :items="actionItems" value-key="value" class="w-full" />
        </UFormField>
        <UFormField v-if="plan.action.type !== 'none'" :label="$t('projectTools.pricing.buttonLabel')">
          <UInput v-model="plan.action.label" :maxlength="PRICING_LIMITS.label" :placeholder="plan.trialDays ? $t('projectTools.pricing.trialPlaceholder', { days: plan.trialDays }) : $t('projectTools.pricing.buttonLabelPlaceholder')" class="w-full" />
        </UFormField>
        <UFormField v-if="plan.action.type === 'url'" :label="$t('projectTools.pricing.buttonUrl')" :help="$t('projectTools.pricing.buttonUrlHint')" class="sm:col-span-2">
          <UInput v-model="plan.action.url" placeholder="https://" class="w-full font-mono" />
        </UFormField>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PRICING_ACTIONS, PRICING_INTERVALS, PRICING_KEY, PRICING_LIMITS, pricingKeyFrom, resolvePlanPrices, slotOfPrice, type PricingInterval, type PricingPlan, type PublicPricingPrice, type StripeCatalog } from '#shared/pricing'
import { formatMoney, fromMinor } from '#shared/stripe'

const props = defineProps<{ index: number, count: number, stripe: StripeCatalog | null, currency: string, startOpen?: boolean }>()
const plan = defineModel<PricingPlan>('plan', { required: true })
const emit = defineEmits<{ move: [by: number], remove: [], 'import-features': [names: string[]] }>()
const { t } = useI18n()

const open = ref(!!props.startOpen)
// A new plan's key follows its name until someone edits the key.
const keyEdited = ref(!!plan.value.key && plan.value.key !== pricingKeyFrom(plan.value.name, 'plan'))
function followKey() {
  if (!keyEdited.value) plan.value.key = pricingKeyFrom(plan.value.name, `plan-${props.index + 1}`)
}

const product = computed(() => props.stripe?.products.find(p => p.id === plan.value.stripeProduct) || null)
const productItems = computed(() => (props.stripe?.products || []).map(p => ({ label: p.name || p.id, value: p.id })))
const resolved = computed(() => resolvePlanPrices(plan.value, props.stripe, { currency: props.currency }))
const money = (price: PublicPricingPrice) => formatMoney(price.amount, price.currency)

const AUTO = '__auto'
const NONE = '__none'
/** A slot's Stripe choice: a price id, the product's current price (auto), or none. */
const priceChoice = reactive(Object.fromEntries(PRICING_INTERVALS.map(slot => [slot, computed({
  get: () => plan.value.prices[slot].stripePrice || (plan.value.stripeProduct ? AUTO : NONE),
  set: (value: string) => { plan.value.prices[slot].stripePrice = value === AUTO || value === NONE ? '' : value }
})])) as Record<PricingInterval, string>)

function priceItems(slot: PricingInterval) {
  const fits = (props.stripe?.prices || []).filter(p => slotOfPrice(p) === slot && (!plan.value.stripeProduct || p.product === plan.value.stripeProduct))
  const auto = plan.value.stripeProduct ? [{ label: t('projectTools.pricing.autoPrice'), value: AUTO }] : [{ label: t('projectTools.pricing.noStripePrice'), value: NONE }]
  return [...auto, ...fits.map(p => ({ label: `${formatMoney(fromMinor(p.amount, p.currency), p.currency)}${p.intervalCount > 1 ? ` / ${p.intervalCount} ${p.interval}s` : ''}${p.nickname ? ` · ${p.nickname}` : ''}${p.lookupKey ? ` · ${p.lookupKey}` : ''}`, value: p.id }))]
}

function setAmount(slot: PricingInterval, value: string | number) {
  const n = value === '' || value === null ? null : Number(value)
  plan.value.prices[slot].amount = n === null || !Number.isFinite(n) ? null : Math.max(0, n)
}

// Written prices in other currencies: only slots with a written price use them.
const writtenSlots = computed(() => PRICING_INTERVALS.filter(slot => plan.value.prices[slot].amount !== null))
const added = ref<string[]>([])
const otherCurrencies = computed(() => [...new Set([...PRICING_INTERVALS.flatMap(slot => Object.keys(plan.value.prices[slot].amounts)), ...added.value])].filter(code => code !== props.currency.toLowerCase()).sort())
const newCurrency = ref('')
const canAddCurrency = computed(() => /^[a-z]{3}$/i.test(newCurrency.value) && !otherCurrencies.value.includes(newCurrency.value.toLowerCase()) && newCurrency.value.toLowerCase() !== props.currency.toLowerCase())

function addCurrency() {
  if (!canAddCurrency.value) return
  added.value.push(newCurrency.value.toLowerCase())
  newCurrency.value = ''
}

function setOtherAmount(slot: PricingInterval, code: string, value: string | number) {
  const n = value === '' || value === null ? null : Number(value)
  const amounts = plan.value.prices[slot].amounts
  if (n === null || !Number.isFinite(n)) delete amounts[code]
  else amounts[code] = Math.max(0, n)
}

function removeCurrency(code: string) {
  for (const slot of PRICING_INTERVALS) delete plan.value.prices[slot].amounts[code]
  added.value = added.value.filter(c => c !== code)
}

const actionItems = computed(() => PRICING_ACTIONS.map(value => ({ value, label: t(`projectTools.pricing.actions.${value}`) })))
</script>
