// Log structure rather than arbitrary service values. No credentials are needed for diagnostics.
export type Log = (message: string) => void;
export function redactText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [REDACTED]')
    .replace(/((?:["']?[\w-]*(?:token|secret|password|credential|api[_-]?key|authorization|cookie|account[_-]?id)[\w-]*["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-|sess-)[\w-]+/g, '[REDACTED]')
    .replace(/[A-Za-z0-9_+/=-]{32,}(?:\.[A-Za-z0-9_+/=-]+)*/g, '[REDACTED]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, '[LOCAL PATH REDACTED]')
    .replace(/(?<![:\w])\/(?:[^\s"'<>]+\/?)+/g, '[LOCAL PATH REDACTED]');
}
export function responseShape(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (depth > 8) return '<depth limit>';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => responseShape(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, v]) => [
      redactText(key),
      /token|secret|password|credential|authorization|cookie|api[_-]?key/i.test(key) ? '[REDACTED]' :
        (['usedPercent', 'windowDurationMins', 'resetsAt'].includes(key) && typeof v === 'number' ? v : responseShape(v, depth + 1)),
    ]));
  }
  // Even unknown string/number fields could contain future credentials or private account data.
  return `<${typeof value}>`;
}
