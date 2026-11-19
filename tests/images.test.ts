import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { boot, EAN } from './helpers.ts';
import { sniffImage, validateImage, allowedRemoteImage, setImageFetch, clearRemoteImageCache, MAX_IMAGE_BYTES, MAX_IMAGES_PER_PRODUCT } from '../server/src/images.ts';
import { openBeautyFacts } from '../server/src/enrichment/openbeautyfacts.ts';
import { setConnectors, resetLimiter } from '../server/src/enrichment/engine.ts';

// ---- tiny but structurally valid fixtures ----
function png(w: number, h: number): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
function webpX(w: number, h: number) { const b = Buffer.alloc(34); b.write('RIFF', 0); b.writeUInt32LE(26, 4); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; }

test('images: type is decided by magic bytes and dimensions are read (PNG / JPEG / WebP); others rejected', () => {
  assert.deepEqual(sniffImage(png(3, 2)), { mime: 'image/png', width: 3, height: 2 });
  assert.deepEqual(sniffImage(jpeg(640, 480)), { mime: 'image/jpeg', width: 640, height: 480 });
  assert.deepEqual(sniffImage(webpX(1200, 900)), { mime: 'image/webp', width: 1200, height: 900 });
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null, 'SVG (scriptable) is not accepted');
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
  assert.equal(sniffImage(Buffer.from('%PDF-1.7 fake')), null);
  assert.throws(() => validateImage(new Uint8Array()), /فارغ/);
  assert.throws(() => validateImage(Buffer.concat([jpeg(10, 10), Buffer.alloc(MAX_IMAGE_BYTES)])), /ميغابايت/);
  assert.throws(() => validateImage(jpeg(9000, 10)), /أبعاد/);
});

test('images: remote fetch is limited to https allow-listed hosts (no SSRF to internal/other hosts)', () => {
  assert.ok(allowedRemoteImage('https://images.openbeautyfacts.org/images/products/1/front_en.4.400.jpg'));
  for (const u of ['http://images.openbeautyfacts.org/x.jpg', 'https://evil.example/x.jpg', 'https://images.openbeautyfacts.org.evil.example/x.jpg', 'https://user:pw@images.openbeautyfacts.org/x.jpg',
    'https://images.openbeautyfacts.org:8443/x.jpg', 'https://127.0.0.1/x.jpg', 'file:///etc/passwd', 'not a url']) assert.equal(allowedRemoteImage(u), false, u);
});

test('images API: upload (camera/gallery), list, serve behind login, primary handling, limits, permissions', async () => {
  const t = await boot();
  try {
    const pid = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج صور', barcode: EAN } })).json.id;
    const up = (tok: string, b: Buffer, q = 'kind=front&origin=camera') => t.call('POST', `/api/products/${pid}/images?${q}`, { token: tok, raw: b });
    assert.equal((await up('', png(4, 4))).status, 401, 'login required');
    const a = await up(t.staff, png(4, 4)); assert.equal(a.status, 200); assert.equal(a.json.image.is_primary, 1, 'first image becomes primary'); assert.equal(a.json.image.origin, 'camera');
    const b = await up(t.manager, jpeg(800, 600), 'kind=ingredients&origin=upload'); assert.equal(b.json.image.is_primary, 0); assert.equal(b.json.image.width, 800);
    assert.equal((await up(t.staff, Buffer.from('<svg onload=alert(1)>'))).status, 400, 'non-image rejected');
    assert.equal((await up(t.staff, png(2, 2), 'kind=price&origin=upload')).status, 400, 'unknown kind rejected');
    assert.equal((await up(t.staff, png(2, 2), 'kind=front&origin=source')).status, 400, 'clients cannot claim a source origin');

    const list = await t.call('GET', `/api/products/${pid}/images`, { token: t.staff });
    assert.equal(list.json.images.length, 2); assert.ok(!('bytes' in list.json.images[0]), 'metadata only');
    assert.equal((await t.call('GET', `/api/images/${a.json.id}`)).status, 401, 'bytes need login');
    const img = await t.call('GET', `/api/images/${a.json.id}`, { token: t.staff });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png'); assert.match(img.headers.get('content-security-policy') ?? '', /default-src 'none'/);

    // product reads carry the primary image id (cards, search, advisor)
    assert.equal((await t.call('GET', `/api/products/${pid}`, { token: t.staff })).json.product.primary_image_id, a.json.id);
    assert.equal((await t.call('GET', '/api/products?q=' + encodeURIComponent('منتج صور'), { token: t.staff })).json.products[0].primary_image_id, a.json.id);
    assert.equal((await t.call('GET', `/api/products/by-barcode/${EAN}`, { token: t.staff })).json.product.primary_image_id, a.json.id);

    // staff cannot change/delete someone else's image; manager can; deleting the primary promotes another
    assert.equal((await t.call('PATCH', `/api/images/${b.json.id}`, { token: t.staff, body: { primary: true } })).status, 403);
    assert.equal((await t.call('DELETE', `/api/images/${b.json.id}`, { token: t.staff })).status, 403);
    assert.equal((await t.call('PATCH', `/api/images/${b.json.id}`, { token: t.manager, body: { primary: true } })).json.image.is_primary, 1);
    assert.equal((await t.call('GET', `/api/products/${pid}`, { token: t.staff })).json.product.primary_image_id, b.json.id);
    assert.equal((await t.call('DELETE', `/api/images/${a.json.id}`, { token: t.staff })).status, 200, 'staff may delete their own image');
    assert.equal((await t.call('DELETE', `/api/images/${b.json.id}`, { token: t.manager })).status, 200);
    const c1 = await up(t.staff, png(2, 2)); const c2 = await up(t.staff, png(2, 2));
    await t.call('DELETE', `/api/images/${c1.json.id}`, { token: t.staff });
    assert.equal((await t.call('GET', `/api/products/${pid}`, { token: t.staff })).json.product.primary_image_id, c2.json.id, 'next image promoted');

    for (let i = 1; i < MAX_IMAGES_PER_PRODUCT; i++) await up(t.staff, png(2, 2));
    assert.equal((await up(t.staff, png(2, 2))).status, 409, 'per-product cap');

    // deleting the product removes its images (no orphans); scope policy holds
    await t.call('DELETE', `/api/products/${pid}`, { token: t.manager });
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM product_images').get() as { n: number }).n, 0);
    const cols = (t.db.prepare('PRAGMA table_info(product_images)').all() as { name: string }[]).map((x) => x.name).join(',');
    assert.doesNotMatch(cols, /price|cost|qty|quantity|amount/i);
  } finally { await t.close(); }
});

test('OBF images: connector proposes the front photo of the SAME record; manager approval stores it with source, licence, attribution', async () => {
  const B = '3337875598996';
  const remote = 'https://images.openbeautyfacts.org/images/products/333/787/559/8996/front_en.28.400.jpg';
  const fake = (u: string) => Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'success', product: { code: B, product_name: 'moisturising cream', brands: 'CeraVe', quantity: '340 g', image_front_url: u } }) });
  // a foreign host is never proposed
  const evil = await openBeautyFacts({ contact: 'x', fetchImpl: () => fake('https://evil.example/a.jpg') as never }).lookupBarcode(B);
  assert.ok(evil.found && !('image_url' in evil.fields));
  const t = await boot();
  const fetched: string[] = [];
  setImageFetch(async (u, init) => { fetched.push(u); assert.equal(init.redirect, 'error'); return { ok: true, status: 200, arrayBuffer: async () => { const b = jpeg(400, 400); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } }; });
  try {
    resetLimiter(); clearRemoteImageCache();
    setConnectors([openBeautyFacts({ contact: 'x', fetchImpl: () => fake(remote) as never })]);
    const look = await t.call('POST', '/api/enrichment/lookup', { token: t.staff, body: { barcode: B } });
    const cand = look.json.candidates.find((x: { field: string }) => x.field === 'image_url');
    assert.ok(cand, 'image candidate is a DRAFT'); assert.equal(cand.value, remote);
    const prev = await t.call('GET', `/api/enrichment/candidates/${cand.id}/image`, { token: t.staff });
    assert.equal(prev.status, 200); assert.equal(prev.headers.get('content-type'), 'image/jpeg');
    assert.equal((await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.staff, body: { action: 'approve' } })).status, 403, 'staff cannot approve');
    assert.equal((await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.manager, body: { action: 'approve' } })).status, 409, 'no product card yet');
    const pid = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'CeraVe cream', barcode: B } })).json.id;
    const ok = await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.manager, body: { action: 'approve' } });
    assert.equal(ok.status, 200);
    const [img] = (await t.call('GET', `/api/products/${pid}/images`, { token: t.staff })).json.images;
    assert.equal(img.origin, 'source'); assert.equal(img.license, 'CC BY-SA 3.0'); assert.match(img.attribution, /Open Beauty Facts/); assert.match(img.source_url, /openbeautyfacts\.org\/product\/3337875598996/);
    assert.match(img.identity_note, /العبوة/); assert.equal(img.is_primary, 1);
    assert.equal((await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.manager, body: { action: 'approve' } })).status, 409, 'cannot approve twice');
    assert.ok(fetched.every((u) => u === remote));
    // the product's text verification is untouched by an image
    assert.equal((await t.call('GET', `/api/products/${pid}`, { token: t.staff })).json.product.verification, 'review');
  } finally { setImageFetch(null); setConnectors([]); await t.close(); }
});

test('OBF data accuracy: a pack size without a unit (e.g. "177") is not proposed; "177 ml" is', async () => {
  const B = '3337875598996';
  const mk = (q: string) => openBeautyFacts({ contact: 'x', fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'success', product: { code: B, product_name: 'cream', quantity: q } }) }) as never }).lookupBarcode(B);
  const a = await mk('177'); assert.ok(a.found && !('size' in a.fields));
  const b = await mk('177 ml'); assert.ok(b.found && b.fields.size === '177 ml');
  const c = await mk('٢٠٠ مل'); assert.ok(c.found && c.fields.size === '٢٠٠ مل');
  const d = await mk('٢٠٠'); assert.ok(d.found && !('size' in d.fields), 'bare Arabic-Indic number has no unit either');
});
