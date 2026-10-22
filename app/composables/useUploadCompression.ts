/**
 * How the panel's image uploads are sent (the server side is server/utils/imageCompress.ts): as they are, smaller as
 * WebP, or, where the image is kept as a file to use in a <picture> (the media library), as AVIF and WebP with a
 * JPEG or PNG fallback. One choice for the whole panel, remembered in this browser; smaller by default.
 */
export type UploadCompression = 'off' | 'webp' | 'modern'

const KEY = 'hb:upload-compression'

export function useUploadCompression() {
  const mode = useState<UploadCompression>('upload-compression', () => 'webp')
  onMounted(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved === 'off' || saved === 'webp' || saved === 'modern') mode.value = saved
    } catch {}
  })
  watch(mode, (value) => {
    try { localStorage.setItem(KEY, value) } catch {}
  })

  /** Adds the choice to an upload. `sets`: the upload can keep several files (a media-library asset); elsewhere one smaller file is sent. */
  function apply(form: FormData, options: { sets?: boolean } = {}) {
    if (mode.value === 'modern' && options.sets) form.append('formats', 'avif,webp')
    else if (mode.value !== 'off') form.append('compress', 'true')
  }

  return { mode, apply }
}
