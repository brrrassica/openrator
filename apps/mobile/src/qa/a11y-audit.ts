/**
 * OpenRator — accessibility audits (M5.3/M5.4).
 *
 * Two deterministic, dependency-free gates:
 *
 * 1. `auditThemeContrast` — WCAG 2.1 contrast ratios for every meaningful
 *    foreground/background token pair in light and dark mode.
 * 2. `scanTappableSource` — static scan of UI source for `Pressable` /
 *    `Touchable*` elements and their resolved style, enforcing a ≥ 44 px touch
 *    target (`minHeight`) or an explicit `hitSlop`.
 *
 * Both are pure functions so the test tree can feed them the real source files
 * (the src secrets-guard whitelist stays clean because no I/O lives here).
 */

/** WCAG 2.5.5 / Material minimum touch target. */
export const MIN_TOUCH_TARGET_PX = 44;

/** WCAG 2.1 AA minimum contrast for normal-size text. */
export const MIN_CONTRAST_NORMAL = 4.5;

export interface ContrastCheck {
  foreground: string;
  background: string;
  ratio: number;
  ok: boolean;
}

export interface ContrastTheme {
  mode: string;
  bg: string;
  card: string;
  text: string;
  subtext: string;
  accent: string;
  accentText: string;
  warn: string;
  danger: string;
  ok: string;
}

/** Parse `#rgb` / `#rrggbb` into linearised sRGB components (0..1). */
export function relativeLuminance(hex: string): number {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`invalid hex colour: ${hex}`);
  }
  const channel = (offset: number): number => {
    const v = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two `#rrggbb` colours (1..21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Token pairs that must stay readable in both colour schemes. */
export function auditThemeContrast(theme: ContrastTheme): ContrastCheck[] {
  const pairs: Array<[keyof ContrastTheme, keyof ContrastTheme]> = [
    ['text', 'bg'],
    ['text', 'card'],
    ['subtext', 'bg'],
    ['subtext', 'card'],
    ['accent', 'bg'],
    ['accent', 'card'],
    ['accentText', 'accent'],
    ['warn', 'bg'],
    ['warn', 'card'],
    ['danger', 'bg'],
    ['danger', 'card'],
    ['ok', 'bg'],
    ['ok', 'card'],
  ];
  return pairs.map(([fg, bg]) => {
    const ratio = contrastRatio(String(theme[fg]), String(theme[bg]));
    return {
      foreground: String(theme[fg]),
      background: String(theme[bg]),
      ratio: Math.round(ratio * 100) / 100,
      ok: ratio >= MIN_CONTRAST_NORMAL,
    };
  });
}

export type TappableStatus = 'ok' | 'missing-target' | 'unresolved-style';

export interface TappableFinding {
  file: string;
  /** 1-based line of the opening tag. */
  line: number;
  tag: string;
  status: TappableStatus;
  detail: string;
}

const TAPPABLE = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'] as const;
const TAPPABLE_RE = new RegExp(`<(${TAPPABLE.join('|')})(?=[\\s/>])`, 'g');
const STYLE_ENTRY_RE = /([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*)\}/g;

/** Split a source file into a map of `StyleSheet` entry name → body text. */
export function extractStyleEntries(source: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const match of source.matchAll(STYLE_ENTRY_RE)) {
    const [, name, body] = match;
    // First definition wins; later object literals are unrelated inline props.
    if (!entries.has(name)) entries.set(name, body);
  }
  return entries;
}

/** Width of the opening tag starting at `index` (handles `{}`, strings, `/>`). */
function readOpeningTag(source: string, index: number): { text: string; end: number } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = index + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      continue;
    }
    if (ch === '>' && depth === 0 && source[i - 1] !== '=') {
      return { text: source.slice(index, i + 1), end: i + 1 };
    }
  }
  return { text: source.slice(index), end: source.length };
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === '\n') line++;
  return line;
}

function minHeightIn(body: string): number | null {
  const m = body.match(/minHeight\s*:\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Scan a single source file for tappable elements whose resolved style lacks a
 * ≥ 44 px minimum height (and which do not opt into `hitSlop`).
 */
export function scanTappableSource(file: string, source: string): TappableFinding[] {
  const styles = extractStyleEntries(source);
  const findings: TappableFinding[] = [];

  for (const match of source.matchAll(TAPPABLE_RE)) {
    const tag = match[1];
    const start = match.index ?? 0;
    const { text } = readOpeningTag(source, start);
    const line = lineAt(source, start);

    if (/\bhitSlop\b/.test(text)) {
      findings.push({ file, line, tag, status: 'ok', detail: 'hitSlop' });
      continue;
    }

    const styleNames = [...text.matchAll(/styles\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    if (styleNames.length > 0) {
      const unresolved = styleNames.filter((n) => !styles.has(n));
      if (unresolved.length > 0) {
        findings.push({
          file,
          line,
          tag,
          status: 'unresolved-style',
          detail: unresolved.map((n) => `styles.${n}`).join(', '),
        });
        continue;
      }
      const short = styleNames.filter((n) => {
        const h = minHeightIn(styles.get(n) ?? '');
        return h === null || h < MIN_TOUCH_TARGET_PX;
      });
      findings.push({
        file,
        line,
        tag,
        status: short.length === 0 ? 'ok' : 'missing-target',
        detail:
          short.length === 0
            ? styleNames.map((n) => `styles.${n}`).join(', ')
            : `${short.map((n) => `styles.${n}`).join(', ')} needs minHeight ≥ ${MIN_TOUCH_TARGET_PX} or hitSlop`,
      });
      continue;
    }

    // No named style: accept an inline minHeight, otherwise it needs hitSlop.
    const inline = minHeightIn(text);
    const ok = inline !== null && inline >= MIN_TOUCH_TARGET_PX;
    findings.push({
      file,
      line,
      tag,
      status: ok ? 'ok' : 'missing-target',
      detail: ok ? `inline minHeight ${inline}` : `inline element needs minHeight ≥ ${MIN_TOUCH_TARGET_PX} or hitSlop`,
    });
  }
  return findings;
}
