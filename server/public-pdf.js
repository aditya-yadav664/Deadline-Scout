import { execFile } from 'node:child_process';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extract } from '../extension/shared/extract.js';

const execute = promisify(execFile);

export async function readPublicPdf(bytes, url) {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('The source is not a readable PDF.');
  const directory = await mkdtemp(join(tmpdir(), 'deadline-scout-pdf-'));
  const path = join(directory, 'source.pdf');
  let text;
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    const { stdout } = await execute('pdftotext', ['-l', '20', '-layout', '-enc', 'UTF-8', path, '-'], {
      env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      timeout: 5000, maxBuffer: 256000, windowsHide: true
    });
    text = stdout.trim();
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? 'Public PDF reading is unavailable on this server.' : 'The PDF could not be read safely.');
  } finally {
    await unlink(path).catch(() => {});
    await rmdir(directory).catch(() => {});
  }
  if (!text) throw new Error('This PDF has no selectable text in its first 20 pages.');
  const title = text.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 200);
  return { title, url, text, milestones: extract(text, url), links: [], hasScripts: false, readability: 'readable', sourceType: 'pdf' };
}
