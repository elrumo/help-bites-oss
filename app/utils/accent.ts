// A project's accent as NuxtUI's whole primary scale, mixed from the one
// colour. The widgets set it on their own <html>, so `--ui-primary` (500 in
// light, 400 in dark) recomputes from it and teleported menus follow too.
export function accentStyle(accent?: string | null): string {
  if (!accent) return ''
  const mix = (other: string, amount: number) => `color-mix(in oklab, ${accent} ${amount}%, ${other})`
  const shades: Record<number, string> = {
    50: mix('white', 8), 100: mix('white', 15), 200: mix('white', 28), 300: mix('white', 50), 400: mix('white', 75),
    500: accent, 600: mix('black', 88), 700: mix('black', 76), 800: mix('black', 62), 900: mix('black', 50), 950: mix('black', 34)
  }
  return Object.entries(shades).map(([shade, value]) => `--ui-color-primary-${shade}: ${value}`).join('; ')
}
