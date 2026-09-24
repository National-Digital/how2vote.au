/**
 * A screen's wording as its copy registry writes it: text with each value named, `{n}` for one
 * (`QUIZ_COPY`, `BALLOT_COPY`).
 */

/** A template's parts: its text, and the name of each value in it. */
export function parts(template: string): ({ text: string } | { value: string })[] {
  return template
    .split(/(\{[a-z]+\})/)
    .filter(Boolean)
    .map((part) => (/^\{[a-z]+\}$/.test(part) ? { value: part.slice(1, -1) } : { text: part }));
}

/** A template's text on either side of its one value, for a page that places markup there. */
export function around(template: string): [string, string] {
  const [before = "", after = ""] = template.split(/\{[a-z]+\}/);
  return [before, after];
}

/** A template with its values filled. A value it names and is not given is left as `{name}`. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-z]+)\}/g, (named, name: string) => String(values[name] ?? named));
}
