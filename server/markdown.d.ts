// Nitro bundles an imported .md file as its text (server/utils/docsSource.ts).
declare module '*.md' {
  const text: string
  export default text
}
