// ANSI colors, OSC 8 hyperlinks, and helpers for text that may contain either.

export const RESET = '\x1b[0m';
const sgr = (code) => (text) => `\x1b[${code}m${text}${RESET}`;
export const bold = sgr('1');
export const dim = sgr('2');
export const inverse = sgr('7');
export const red = sgr('31');
export const green = sgr('32');
export const yellow = sgr('33');
export const cyan = sgr('36');
export const color = (code, text) => sgr(code)(text);

const openLink = (url) => `\x1b]8;;${url}\x1b\\`;
const CLOSE_LINK = '\x1b]8;;\x1b\\';
export const link = (url, text) => `${openLink(url)}${text}${CLOSE_LINK}`;

const OSC_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const NON_SGR_CSI = /\x1b\[[0-9;?]*[ -/]*[@-ln-~]/g;
const OTHER_ESCAPE = /\x1b[()][0-9A-Za-z]|\x1b[=>78]/g;
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g;
const INVISIBLE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const TOKEN = /\x1b\[[0-9;]*m|\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)|./gsu;

// Keep colors, drop cursor movement, links and anything else that would corrupt the layout.
// Runs on raw runner output only; our own links are added after.
export function sanitize(line) {
  return line
    .replace(OSC_SEQUENCE, '')
    .replace(NON_SGR_CSI, '')
    .replace(OTHER_ESCAPE, '')
    .replace(CONTROL_CHARS, '')
    .replaceAll('\t', '    ');
}

export const stripAnsi = (text) => text.replace(INVISIBLE, '');
const visibleLength = (text) => [...stripAnsi(text)].length;
export const padEnd = (text, width) =>
  text + ' '.repeat(Math.max(0, width - visibleLength(text)));

// Splits a line into rows of at most `width` columns. Each row carries the
// column ranges of its links so clicks can be mapped back to a URL.
export function wrap(line, width) {
  const rows = [];
  let row = '';
  let length = 0;
  let colors = '';
  let url = '';
  let linkStart = 0;
  let links = [];

  const closeSpan = () => {
    if (url && length > linkStart) links.push({ from: linkStart, to: length, url });
  };
  const endRow = () => {
    closeSpan();
    rows.push({ text: row + (url ? CLOSE_LINK : '') + RESET, links });
  };

  for (const [token, href] of line.matchAll(TOKEN)) {
    if (token.startsWith('\x1b[')) {
      row += token;
      colors = token === '\x1b[0m' || token === '\x1b[m' ? '' : colors + token;
      continue;
    }
    if (token.startsWith('\x1b]')) {
      closeSpan();
      url = href;
      linkStart = length;
      row += token;
      continue;
    }
    if (length === width) {
      endRow();
      row = colors + (url ? openLink(url) : '');
      length = 0;
      linkStart = 0;
      links = [];
    }
    row += token;
    length++;
  }
  endRow();
  return rows;
}

// The first row of `wrap`: the text cut to `width` columns, with its links.
export const fit = (text, width) => wrap(text, width)[0];
