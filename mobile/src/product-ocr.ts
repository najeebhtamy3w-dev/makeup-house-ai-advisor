import { Capacitor, registerPlugin } from '@capacitor/core';
interface OCRResult { text:string; ocr:true; vision:false; mean_confidence:number; warning:string; duration_ms:number }
const native=registerPlugin<{capabilities(p:{token:string}):Promise<unknown>;recognize(p:{token:string;image_base64:string}):Promise<OCRResult>;cancel(p:{token:string}):Promise<void>}>('ProductOCR');
export const productOCR={
 available:Capacitor.isNativePlatform(),
 async recognize(blob:Blob,token:string){
  if(!this.available)throw Error('OCR_ANDROID_ONLY');
  if(!blob.size||blob.size>2097152)throw Error('OCR_IMAGE_TOO_LARGE');
  const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('OCR_IMAGE_READ'));reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(blob);});
  return native.recognize({token,image_base64:encoded});
 },
 cancel(token:string){return native.cancel({token});}
};
declare global { interface Window { MHProductOCR?:typeof productOCR } }
window.MHProductOCR=productOCR;
