// What release this is. The number lives in package.json (and the native app's
// MARKETING_VERSION, kept equal by tests/versionParity.test.ts); the build bakes
// it into runtimeConfig.public.version. Bump both, move CHANGELOG.md's
// "Unreleased" under the new number, tag vX.Y.Z (docs/RELEASING.md).

/** The product is in public beta: the version shows a Beta tag until this is set to `null`. */
export const RELEASE_STAGE: 'beta' | null = 'beta'

/** The public changelog this project keeps on its own HelpBites (docs/RELEASING.md, "Public changelog"). */
export const CHANGELOG_URL = 'https://helpbites.app/changelog/pk_68ccfcddaabeee44c8cd907a'
