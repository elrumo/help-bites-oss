// The panel draws pricing tables with the same public/pricing.js sites load,
// so a preview looks exactly like the real thing. The script is added once.

type PricingQueue = { push: (command: unknown[]) => void }

export function pricingQueue(): PricingQueue {
  const w = window as unknown as { HelpBitesPricing?: PricingQueue | unknown[] }
  w.HelpBitesPricing ||= []
  if (!document.querySelector('script[data-hb-pricing-preview], script[data-hb-pricing]')) {
    const script = document.createElement('script')
    script.src = '/pricing.js'
    script.dataset.hbPricingPreview = ''
    document.head.appendChild(script)
  }
  return w.HelpBitesPricing as PricingQueue
}
