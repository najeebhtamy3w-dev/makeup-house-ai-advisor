# Product/image memory integration checkpoint

Status: IMPLEMENTED / HOST VERIFIED for bounded product-memory APIs; NOT multimodal model acceptance.
Date: 2026-11-26. Work is limited to `server/src/intelligence/product-attachments.ts` and `tests/intelligence-product-attachments.test.ts`.

## Reused existing components

- `server/src/images.ts`: actual SQLite BLOB image memory, authenticated image bytes, magic-byte/size/dimension validation, metadata listing, upload provenance, thumbnail fallback and per-product limits. Existing image upload API is used after product confirmation; no second image store.
- `server/src/gtin.ts`: existing code normalization/check-digit validation.
- Existing `products`/`product_codes` identity and client_ref unique index; no new migration and no deletion/replacement of records.
- `server/src/intelligence/inventory.ts:checkValidBatches`: source of local availability, never the model or an image.
- `server/src/db.ts:audit`: product draft confirmation audit inside an atomic savepoint.

## New API surface

Import `./product-attachments.ts` once from `server/src/intelligence/routes.ts` to register these authenticated routes:

- GET `/api/intelligence/products/:id/images`: real stored metadata and authenticated `/api/images/:id`/`?size=thumb` URLs. Positive IDs are local; negative reviewed-global IDs return `not_stored` with no invented image.
- GET `/api/intelligence/identity/barcode/:code`: exact primary/additional stored-code match. Barcode is not authenticity evidence. Active records only; availability uses valid batches.
- POST `/api/intelligence/attachments/inspect-image`: raw image bytes -> existing validator results. Explicit `ocr:false`, `visual_understanding:false`, `barcode_decoded:false`.
- POST `/api/intelligence/product-drafts/preview`: strict explicit employee/transcription/manufacturer fields; no write, no invented concentration/efficacy, no financial fields.
- POST `/api/intelligence/product-drafts/confirm`: manager-only + `confirmed:true` + bounded `client_ref`; inserts review-only draft with unknown inventory, audit and duplicate protection. Existing authenticated image-upload API follows after confirmation. Not registered as a model write tool.

Exports: `getStoredProductImages`, `resolveBarcodeIdentity`, `inspectProductImage`, `buildProductAttachmentDraft`, `saveConfirmedProductAttachmentDraft`.

## Actual verification

`node --import tsx --test tests/intelligence-product-attachments.test.ts`: **6 passed, 0 failed, 0 skipped**.
Raw log: `unified-core-evidence/product-attachments-tests.log` outside repo, root should package it with delivery evidence.

Checks cover:

1. Byte validation and honest no-OCR/no-vision status.
2. Preview causes no product write; financial/approval/inferred attributes and unsafe URLs rejected.
3. Manager confirmation, actual review-only record/audit, idempotency, primary/additional barcode dedup.
4. Audit failure rolls back product creation.
5. Actual stored image metadata and authenticated bytes/thumbnail routes; no invented global images; archived code cannot become duplicate record.
6. Product and actual image BLOB survive SQLite close/reopen byte-for-byte, independent of model.

`npx tsc --noEmit`: exit 0 on shared integrated state at this checkpoint. No Android/phone test claimed.

## Limitations / next integration

- No OCR engine, VLM, projector, visual embedding or decoded photo recognition is implemented by this module.
- Header-only synthetic PNG fixtures test metadata validation, not real photo decoding or intelligence.
- No live manufacturer lookup or external transmission occurs.
- No scientific review, authenticity approval or stock mutation occurs.
- Chat camera/file chooser and model-selected `get_product_images` need root/UI integration. Existing barcode scanner/upload/Excel flows remain unchanged.
- Existing full backup/mobile-WASM suites should run after integration; no fresh MHBAK roundtrip claimed here.
