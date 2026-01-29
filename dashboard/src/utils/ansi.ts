/**
 * Convert ANSI escape codes to HTML spans with inline HTML escaping
 * Matches the original reflexive.js implementation exactly
 */

const ANSI_COLORS: Record<string, string> = {
  '30': '#000', '31': '#ef4444', '32': '#22c55e', '33': '#eab308',
  '34': '#3b82f6', '35': '#a855f7', '36': '#06b6d4', '37': '#e5e5e5',
  '90': '#737373', '91': '#fca5a5', '92': '#86efac', '93': '#fde047',
  '94': '#93c5fd', '95': '#d8b4fe', '96': '#67e8f9', '97': '#fff'
};

export function ansiToHtml(text: string): string {
  const ESC = String.fromCharCode(27);
  let result = '';
  let openSpans = 0;
  let i = 0;

  while (i < text.length) {
    // Check for ANSI escape sequence: ESC[...m
    if (text[i] === ESC && text[i + 1] === '[') {
      // Find the end of the sequence (the 'm' character)
      let j = i + 2;
      while (j < text.length && /[0-9;]/.test(text[j])) {
        j++;
      }

      if (text[j] === 'm') {
        const codes = text.slice(i + 2, j);

        if (!codes || codes === '0' || codes === '22' || codes === '39') {
          // Reset - close open span
          if (openSpans > 0) {
            result += '</span>';
            openSpans--;
          }
        } else {
          const parts = codes.split(';');
          let style = '';

          for (const code of parts) {
            if (code === '1') style += 'font-weight:bold;';
            else if (code === '2') style += 'opacity:0.7;';  // Dim
            else if (code === '3') style += 'font-style:italic;';
            else if (code === '4') style += 'text-decoration:underline;';
            else if (ANSI_COLORS[code]) style += 'color:' + ANSI_COLORS[code] + ';';
          }

          if (style) {
            result += '<span style="' + style + '">';
            openSpans++;
          }
        }

        i = j + 1;
        continue;
      }
    }

    // Escape HTML chars inline (exactly like original)
    const c = text[i];
    if (c === '<') result += '&lt;';
    else if (c === '>') result += '&gt;';
    else if (c === '&') result += '&amp;';
    else result += c;
    i++;
  }

  // Close any remaining open spans
  while (openSpans > 0) {
    result += '</span>';
    openSpans--;
  }

  // Convert URLs to clickable links (like original)
  result = result.replace(/(https?:\/\/[^\s<>"']+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-blue-400 underline hover:text-blue-300">$1</a>');

  return result;
}
