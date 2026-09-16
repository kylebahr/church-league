// Minimal SMTP-over-implicit-TLS client. Exists so the mailer has zero
// dependencies: nothing to npm-install, nothing to audit, nothing to break in
// CI two months from now. Tested against smtp.gmail.com:465.

import tls from 'node:tls';

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');

export async function sendMail({
  host = 'smtp.gmail.com', port = 465, user, pass,
  from, to, bcc = [], subject, html, text, replyTo,
}) {
  if (!user || !pass) throw new Error('SMTP user/pass missing (set GMAIL_USER and GMAIL_APP_PASSWORD)');
  const rcpts = [...(Array.isArray(to) ? to : [to]), ...bcc].filter(Boolean);
  if (!rcpts.length) throw new Error('no recipients');

  const sock = tls.connect({ host, port, servername: host });
  sock.setEncoding('utf8');

  let buf = '';
  const waiters = [];
  sock.on('data', chunk => {
    buf += chunk;
    // A complete reply ends with "NNN <sp>...\r\n" (space, not hyphen).
    const m = buf.match(/^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n$/);
    if (m && waiters.length) {
      const w = waiters.shift();
      const reply = buf; buf = '';
      w.resolve({ code: Number(m[1]), reply });
    }
  });

  const fail = err => { while (waiters.length) waiters.shift().reject(err); };
  sock.on('error', fail);
  sock.on('close', () => fail(new Error('SMTP connection closed unexpectedly')));

  const read = (expect) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SMTP timeout')), 30000);
    waiters.push({
      resolve: r => {
        clearTimeout(timer);
        if (expect && !expect.includes(r.code)) {
          return reject(new Error(`SMTP expected ${expect.join('/')} but got: ${r.reply.trim()}`));
        }
        resolve(r);
      },
      reject: e => { clearTimeout(timer); reject(e); },
    });
  });
  const cmd = (line, expect) => { sock.write(line + '\r\n'); return read(expect); };

  try {
    await read([220]);
    await cmd('EHLO church-league.local', [250]);
    await cmd('AUTH LOGIN', [334]);
    await cmd(b64(user), [334]);
    await cmd(b64(pass), [235]);
    await cmd(`MAIL FROM:<${addr(from)}>`, [250]);
    for (const r of rcpts) await cmd(`RCPT TO:<${addr(r)}>`, [250, 251]);
    await cmd('DATA', [354]);
    sock.write(buildMessage({ from, to, subject, html, text, replyTo }));
    sock.write('\r\n.\r\n');
    await read([250]);
    await cmd('QUIT');
  } finally {
    sock.end();
  }
  return { accepted: rcpts.length };
}

const addr = s => {
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).trim();
};

function buildMessage({ from, to, subject, html, text, replyTo }) {
  const boundary = 'cl_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean).join(', ');
  const headers = [
    `From: ${from}`,
    toList ? `To: ${toList}` : 'To: undisclosed-recipients:;',
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean).join('\r\n');

  const body = [
    '', `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit', '',
    dotStuff(text || stripTags(html)),
    '', `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit', '',
    dotStuff(html),
    '', `--${boundary}--`, '',
  ].join('\r\n');

  return headers + '\r\n' + body;
}

/** A bare "." on its own line would terminate DATA early. */
const dotStuff = s => String(s).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
const encodeHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const stripTags = h => String(h)
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|tr|div|h1|h2|h3|li)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '-').replace(/&mdash;/g, '-')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n').trim();
