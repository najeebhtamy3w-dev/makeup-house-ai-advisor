// node:zlib inflateRawSync for XLSX import, keeping the zip-bomb limit (maxOutputLength) of the server version.
import { Buffer } from 'buffer';
import { Inflate } from 'fflate';
export function inflateRawSync(buf: Uint8Array, opts: { maxOutputLength?: number } = {}): Buffer {
  const max = opts.maxOutputLength ?? Infinity; const chunks: Uint8Array[] = []; let n = 0;
  const inf = new Inflate((chunk) => { n += chunk.length; if (n > max) throw new RangeError('maxOutputLength exceeded'); chunks.push(chunk); });
  inf.push(buf, true);
  return Buffer.concat(chunks);
}
export default { inflateRawSync };
