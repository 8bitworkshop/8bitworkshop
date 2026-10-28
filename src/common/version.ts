/**
 * The IDE's own version.
 *
 * scripts/build.mjs reads `version` from package.json and defines
 * __APP_VERSION__ for esbuild; unit tests and unbundled code see it unset.
 */

declare var __APP_VERSION__: string | undefined;

/** The version this build was made from, or '' if it wasn't injected. */
export function getAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
}

/** A display label for a version, e.g. 'v4.0.0'; '' when there is no version. */
export function getAppVersionLabel(version: string = getAppVersion()): string {
  var v = (version || '').trim();
  if (!v) return '';
  return /^v/i.test(v) ? v : 'v' + v;
}
