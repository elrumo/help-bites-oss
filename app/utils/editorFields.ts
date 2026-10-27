// The look of the fields in a side-panel editor (planning items, changelog entries): white inputs on the
// panel's off-white, the same fill `app.config.ts` gives every outline field, so none of them blends into the panel.

/** A property row's select or picker: a leading icon, a label, a white box. */
export const propertyField = { base: 'h-8 w-full rounded-lg ps-8 text-[13px] text-default' }

/** The big title field at the top of an editor. */
export const titleField = { base: 'px-3 text-lg font-semibold' }

/** A row that holds a native input, such as the date: the same box as `propertyField`. */
export const propertyBox = 'relative flex h-8 items-center rounded-lg bg-white ps-8 pe-2 text-[13px] text-default ring ring-inset ring-accented transition-colors hover:ring-(--ui-border-inverted)/30 dark:bg-white/[0.02]'
