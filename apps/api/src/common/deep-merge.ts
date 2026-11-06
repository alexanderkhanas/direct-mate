/**
 * Deep merge for plain objects; arrays and scalars in `patch` replace.
 *
 * Simulator config overrides must merge deeply: a shallow spread of
 * `{preQualify: {enabled: true}}` once deleted preQualify.fields and .prompt,
 * and a killed run left a demo store misconfigured for weeks.
 */
export function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k];
    const bothPlainObjects =
      v !== null && typeof v === 'object' && !Array.isArray(v) && prev !== null && typeof prev === 'object' && !Array.isArray(prev);
    out[k] = bothPlainObjects ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}
