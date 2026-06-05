/** Filesystem-safe slug for output folder names (lowercase, hyphenated, max 60 chars). */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
