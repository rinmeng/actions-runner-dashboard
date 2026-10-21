// Turns a line with ANSI colors and OSC 8 links into styled segments for the
// web dashboard: [{ text, fg?, bold?, dim?, italic?, underline?, url? }].
// `fg` is 0-15 for the terminal's own palette, or "#rrggbb" for 256-color and true color.

const TOKEN = /\x1b\[([0-9;]*)m|\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)|[^\x1b]+|\x1b/g;
const CUBE = [0, 95, 135, 175, 215, 255];
const hex = (...channels) => `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

// xterm's 256-color palette past the first 16: a 6×6×6 cube, then 24 grays.
function color256(n) {
  if (n < 16) return n;
  if (n >= 232) return hex(...Array(3).fill(8 + (n - 232) * 10));
  const index = n - 16;
  return hex(CUBE[Math.floor(index / 36)], CUBE[Math.floor(index / 6) % 6], CUBE[index % 6]);
}

function applySgr(style, params) {
  const codes = params === '' ? [0] : params.split(';').map(Number);
  const next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) for (const key of Object.keys(next)) delete next[key];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code >= 30 && code <= 37) next.fg = code - 30;
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8;
    else if (code === 39) delete next.fg;
    else if (code === 38 || code === 48) {
      // Extended color: 5;n or 2;r;g;b. Backgrounds are skipped but their arguments consumed.
      let value;
      if (codes[i + 1] === 5) {
        value = color256(codes[i + 2] ?? 0);
        i += 2;
      } else if (codes[i + 1] === 2) {
        value = hex(...[codes[i + 2], codes[i + 3], codes[i + 4]].map((channel) => (channel ?? 0) & 255));
        i += 4;
      }
      if (code === 38 && value !== undefined) next.fg = value;
    }
  }
  return next;
}

const sameStyle = (a, b) =>
  a.fg === b.fg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline && a.url === b.url;

export function toSegments(line) {
  const segments = [];
  let style = {};
  let url;
  for (const [token, params, href] of line.matchAll(TOKEN)) {
    if (params !== undefined) {
      style = applySgr(style, params);
      continue;
    }
    if (href !== undefined) {
      url = href || undefined;
      continue;
    }
    if (token === '\x1b') continue;
    const segment = url ? { text: token, ...style, url } : { text: token, ...style };
    const last = segments.at(-1);
    if (last && sameStyle(last, segment)) last.text += token;
    else segments.push(segment);
  }
  return segments;
}
