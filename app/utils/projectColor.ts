// A stable colour per project id for projects that set no accent. Hue from a
// hash, kept in the mid-saturation band so any of them sits next to teal.
const PALETTE = ['#c2410c', '#7c3aed', '#0369a1', '#b45309', '#be123c', '#4d7c0f', '#6d28d9', '#0e7490']

export function projectColor(projectId: string): string {
  let hash = 0
  for (const ch of projectId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}
