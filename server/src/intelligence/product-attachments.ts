/** Product memory helpers: actual stored images/identity and explicitly confirmed drafts.
 * Camera bytes are not interpreted as vision/OCR. Existing image storage/limits/auth remain authoritative. */
import { z } from 'zod';
import { audit, now, type DB } from '../db.ts';
import { HttpError, route, type User } from '../http.ts';
import { listImages, validateImage, MAX_IMAGE_BYTES, MAX_IMAGES_PER_PRODUCT } from '../images.ts';
import { normalizeBarcode, gtinValid } from '../gtin.ts';
import {createProductRecord} from '../routes.ts';
import { checkValidBatches } from './inventory.ts';

const text=(max:number)=>z.string().trim().max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'نص غير صالح');
const source=z.union([z.literal(''),z.string().url().max(500).refine(s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'يلزم رابط HTTPS دون بيانات دخول')]);
const Draft=z.object({
 name:text(200).min(1),brand:text(120).default(''),barcode:text(40).default(''),size:text(60).default(''),
 ingredients:text(5000).default(''),source_url:source.default(''),name_ar:text(200).default(''),name_en:text(200).default(''),
 manufacturer:text(160).default(''),variant:text(120).default(''),
 origin:z.enum(['package_transcription','manufacturer_information','employee_input']).default('employee_input'),
}).strict();
export type ProductAttachmentDraft=z.infer<typeof Draft>;

function safeId(id:number){if(!Number.isSafeInteger(id)||!id)throw new HttpError(400,'معرّف منتج غير صالح');return id;}
function validPrimaryBarcode(raw:string){const code=normalizeBarcode(raw);if(code&&!gtinValid(code))throw new HttpError(400,'الباركود غير صالح؛ تأكد من النص ورقم التحقق');return code;}

/** Read-only identity lookup. Barcode identifies a record, never authenticity or availability. */
export function resolveBarcodeIdentity(db:DB,raw:string){
 const code=normalizeBarcode(text(40).min(1).parse(raw));if(!/^[0-9A-Za-z-]{3,40}$/.test(code))throw new HttpError(400,'رمز غير صالح');
 const rows=db.prepare("SELECT DISTINCT p.id,p.name,p.brand,p.size,p.variant,p.verification,p.record_status FROM products p LEFT JOIN product_codes pc ON pc.product_id=p.id WHERE (p.barcode=? OR pc.code=?) AND p.record_status='active' ORDER BY p.id LIMIT 3").all(code,code) as {id:number;name:string;brand:string;size:string;variant:string;verification:string;record_status:string}[];
 return {code,found:rows.length===1,ambiguous:rows.length>1,matches:rows.map(p=>({...p,scope:'local' as const,availability:checkValidBatches(db,p.id).availability})),identity_basis:'exact_stored_code',authenticity:'not_assessed',global_lookup:'not_performed',note:'تطابق الكود لا يثبت الأصالة أو التركيبة أو التوفر؛ التوفر من الدفعات الصالحة فقط.'};
}

/** Returns actual locally stored image metadata only. Caller must use authenticated image endpoints for bytes. */
export function getStoredProductImages(db:DB,productId:number){
 safeId(productId);
 if(productId<0){
  const p=db.prepare("SELECT id,name FROM global_products WHERE id=? AND review_status='reviewed'").get(-productId) as {id:number;name:string}|undefined;
  if(!p)throw new HttpError(404,'المنتج العالمي المراجع غير موجود');
  return {product_id:productId,scope:'global',images:[],status:'not_stored',note:'لا توجد صور محلية لهذا السجل العالمي؛ لم يُجر بحث خارجي ولم تُخترع صورة.'};
 }
 const p=db.prepare("SELECT id,name FROM products WHERE id=? AND record_status='active'").get(productId) as {id:number;name:string}|undefined;
 if(!p)throw new HttpError(404,'المنتج غير موجود');
 const images=listImages(db,productId).map(i=>({...i,url:`/api/images/${i.id}`,thumbnail_url:`/api/images/${i.id}?size=thumb`,identity_verified:i.origin==='source'?false:null}));
 return {product_id:productId,scope:'local',name:p.name,images,status:images.length?'stored':'not_stored',note:'صور فعلية محفوظة؛ مصدر الصورة منفصل عن اعتماد الهوية والمكونات والأصالة. روابط الصور تتطلب تسجيل الدخول.'};
}

/** Safe intake inspection, not recognition: useful for rejecting unsupported/oversized attachments before storage. */
export function inspectProductImage(bytes:Uint8Array){
 const image=validateImage(bytes);
 return {mime:image.mime,width:image.width,height:image.height,size:bytes.length,max_bytes:MAX_IMAGE_BYTES,max_per_product:MAX_IMAGES_PER_PRODUCT,capabilities:{image_validation:true,ocr:false,visual_understanding:false,barcode_decoded:false},next_step:'اربط الصورة بسجل منتج موثق أو اطلب اسم المنتج وصورة المكونات/الباركود؛ لم يُستخرج نص أو هوية من الصورة.'};
}

/** No inference: only fields explicitly supplied by the employee or trusted extraction adapter are retained. */
export function buildProductAttachmentDraft(db:DB,input:unknown){
 const draft=Draft.parse(input);const barcode=validPrimaryBarcode(draft.barcode);draft.barcode=barcode??'';
 const identity=barcode?resolveBarcodeIdentity(db,barcode):null;
 const missing_information=[...(!draft.brand?['brand']:[]),...(!draft.ingredients?['ingredients']:[]),...(!draft.size?['size']:[]),...(!draft.source_url?['source']:[])];
 return {draft,verification:'review',availability:'unknown',requires_confirmation:true,duplicate:identity?.matches??[],missing_information,provenance:draft.origin,note:'مسودة من المعلومات المقدمة، وليست تعرفًا بصريًا أو تحليلًا علميًا معتمدًا. لا تستنتج التركيز أو pH أو الفعالية أو الأصالة من الصورة أو ترتيب INCI.'};
}

/** Explicit human-confirmed write, not registered as a model-callable action. Atomic audit + dedup preserve existing records. */
export function saveConfirmedProductAttachmentDraft(db:DB,user:User,input:unknown){
 if(user.role!=='manager')throw new HttpError(403,'حفظ المسودة المؤكدة للمدير فقط');
 const request=z.object({confirmed:z.literal(true),client_ref:z.string().regex(/^[A-Za-z0-9-]{8,64}$/),draft:Draft}).strict().parse(input);
 const prepared=buildProductAttachmentDraft(db,request.draft),d=prepared.draft;
 const prior=db.prepare('SELECT id,verification FROM products WHERE client_ref=?').get(request.client_ref) as {id:number;verification:string}|undefined;
 if(prior)return {id:prior.id,duplicate_request:true,verification:prior.verification,availability:checkValidBatches(db,prior.id).availability};
 const archivedOrExisting=d.barcode?(db.prepare('SELECT id FROM products WHERE barcode=?').get(d.barcode)??db.prepare('SELECT product_id AS id FROM product_codes WHERE code=?').get(d.barcode)) as {id:number}|undefined:undefined;
 if(archivedOrExisting)throw Object.assign(new HttpError(409,'الكود مرتبط بسجل موجود؛ راجعه أو استعده بدل تكراره'),{existingId:archivedOrExisting.id});
 if(prepared.duplicate.length)throw Object.assign(new HttpError(409,'الكود مسجل مسبقًا؛ راجع المنتج الموجود بدل إنشاء نسخة مكررة'),{existingId:prepared.duplicate[0]!.id});
 const at=now();db.exec('SAVEPOINT confirmed_attachment_draft');
 try{
  const {origin,...fields}=d;
  const created=createProductRecord({db,user},{...fields,verification:'review',availability:'unknown',client_ref:request.client_ref});
  const id=created.id;
  audit(db,user.id,'confirmed_attachment_draft','product',id,JSON.stringify({origin:d.origin,verification:'review',source_url:d.source_url,fields:Object.keys(d).filter(k=>k!=='origin')}));
  db.exec('RELEASE confirmed_attachment_draft');
  return {id,duplicate_request:false,verification:'review',availability:'unknown',images_endpoint:`/api/products/${id}/images`,note:'حُفظت مسودة تحتاج مراجعة؛ الصور تُرفع عبر مسار الصور المحمي الحالي. لا يثبت الحفظ وجود مخزون أو اعتماد علمي.'};
 }catch(e){db.exec('ROLLBACK TO confirmed_attachment_draft');db.exec('RELEASE confirmed_attachment_draft');throw e;}
}

route('GET','/api/intelligence/products/:id/images','any',c=>getStoredProductImages(c.db,Number(c.params.id)));
route('GET','/api/intelligence/identity/barcode/:code','any',c=>resolveBarcodeIdentity(c.db,c.params.code!));
route('POST','/api/intelligence/product-drafts/preview','any',async c=>buildProductAttachmentDraft(c.db,await c.body()));
route('POST','/api/intelligence/product-drafts/confirm','manager',async c=>saveConfirmedProductAttachmentDraft(c.db,c.user!,await c.body()));
route('POST','/api/intelligence/attachments/inspect-image','any',async c=>inspectProductImage(new Uint8Array(await c.raw())));
