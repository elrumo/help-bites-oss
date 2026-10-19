// Linear's shapes for every component, in the panel, the widgets and the
// landing page alike: pill buttons and chips, 8px fields, menus that float a
// step above the page, roomy modals without dividers.
const menu = {
  content: 'rounded-lg shadow-xl dark:bg-elevated dark:ring-accented',
  item: 'data-highlighted:before:bg-elevated data-[state=open]:before:bg-elevated dark:data-highlighted:before:bg-accented dark:data-[state=open]:before:bg-accented'
}
const fieldOutline = 'bg-white dark:bg-white/[0.02]'
const pill = { base: 'rounded-full' }

export default defineAppConfig({
  ui: {
    // Indigo is refined to Linear's own in main.css; the widgets swap in each
    // project's accent.
    colors: { primary: 'indigo', neutral: 'stone' },
    button: {
      slots: { base: 'rounded-full' },
      compoundVariants: [
        // Linear keeps white on the accent in both themes.
        { color: 'primary', variant: 'solid', class: 'text-white bg-primary-500 hover:bg-primary-500/90 active:bg-primary-500/90 disabled:bg-primary-500 aria-disabled:bg-primary-500' },
        { color: 'neutral', variant: 'outline', class: 'ring-default bg-transparent hover:bg-elevated' }
      ]
    },
    badge: { variants: { size: { xs: pill, sm: pill, md: pill, lg: pill, xl: pill } } },
    input: { slots: { base: 'rounded-lg' }, variants: { variant: { outline: fieldOutline } } },
    textarea: { slots: { base: 'rounded-lg' }, variants: { variant: { outline: fieldOutline } } },
    inputTags: { slots: { base: 'rounded-lg' }, variants: { variant: { outline: fieldOutline } } },
    inputNumber: { slots: { base: 'rounded-lg' }, variants: { variant: { outline: fieldOutline } } },
    select: { slots: { base: 'rounded-lg', ...menu }, variants: { variant: { outline: fieldOutline } } },
    selectMenu: { slots: { base: 'rounded-lg', ...menu }, variants: { variant: { outline: fieldOutline } } },
    dropdownMenu: { slots: menu },
    contextMenu: { slots: menu },
    popover: { slots: { content: menu.content } },
    tooltip: { slots: { content: 'h-7 rounded-md px-2 dark:bg-elevated dark:ring-accented' } },
    toast: { slots: { root: 'rounded-xl dark:bg-elevated dark:ring-accented' } },
    modal: {
      slots: {
        content: 'divide-y-0 shadow-2xl dark:ring-accented',
        header: 'min-h-0 px-5 pt-5 pb-0 sm:px-5',
        body: 'px-5 py-4 sm:px-5 sm:py-4',
        footer: 'px-5 pt-0 pb-5 sm:px-5',
        title: 'text-[15px]',
        description: 'text-[13px]',
        close: 'top-3.5 end-3.5'
      },
      variants: { fullscreen: { false: { content: 'rounded-2xl' } }, overlay: { true: { overlay: 'bg-black/30 dark:bg-black/60' } } }
    },
    slideover: {
      slots: {
        overlay: 'bg-black/30 dark:bg-black/60',
        header: 'min-h-12 py-3',
        title: 'text-[15px]',
        description: 'text-[13px]',
        close: 'top-3 end-3'
      }
    },
    drawer: { slots: { overlay: 'bg-black/30 dark:bg-black/60' } }
  }
})
