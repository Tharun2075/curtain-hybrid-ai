// Small text helpers for the UI: pasted-thread headers and a tiny markdown cleaner.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Sender and subject of a pasted thread, from its first "From:" and "Subject:" lines. */
export function parsePasted(text: string): { from: string; subject: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const header = (key: string) => {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'i');
    for (const l of lines) {
      const m = re.exec(l);
      if (m) return m[1].replace(/\s*<[^>]*>\s*$/, '').trim();
    }
    return '';
  };
  const from = header('From').slice(0, 60) || 'Pasted thread';
  const firstBody = lines.find((l) => l && !/^(?:From|To|Cc|Sent|Date|Subject)\s*:/i.test(l) && !/^-{3,}$/.test(l)) ?? '';
  const subject = (header('Subject') || firstBody || 'Pasted thread').slice(0, 60);
  return { from, subject };
}

/** Remove markdown marks so a plain-text box (the draft) never shows "**" or "# ". */
export function stripMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*+]\s+/gm, '$1- ');
}

/** Escaped HTML with **bold** as <b> and "* "/"- " list lines as bullets. No library. */
export function mdToHtml(s: string): string {
  return s
    .replace(/^#{1,6}\s+/gm, '')
    .split(/\r?\n/)
    .map((line) => {
      const bullet = /^\s*(?:[*+-]|\d+[.)])\s+/.exec(line);
      const body = esc(bullet ? line.slice(bullet[0].length) : line)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/__(.+?)__/g, '<b>$1</b>')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1$2');
      return bullet ? `<div class="li">• ${body}</div>` : `<div>${body || '&nbsp;'}</div>`;
    })
    .join('');
}
