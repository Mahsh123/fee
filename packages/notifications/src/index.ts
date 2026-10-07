export type TemplateScalar = string | number | boolean;
export type TemplateValues = Readonly<Record<string, unknown>>;

/** Renders a plain-text message from caller-provided configuration and values. */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/{{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*}}/g, (_token, path: string) => {
    const value = resolveOwnPath(values, path);
    if (value === undefined || value === null) throw new Error(`Template value "${path}" was not supplied`);
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Template value "${path}" must be a string, number, or boolean`);
    }
    return String(value as TemplateScalar);
  });
}

function resolveOwnPath(source: TemplateValues, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return undefined;
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
