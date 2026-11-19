export type EnrichField = 'name' | 'brand' | 'size' | 'ingredients' | 'image_url';
export interface ConnectorFound { found: true; fields: Partial<Record<EnrichField, string>>; sourceUrl: string; /** CP05: data-quality caveat per field (shown to the reviewer) */ notes?: Partial<Record<EnrichField, string>> }
export interface ConnectorMiss { found: false }
export type ConnectorResult = ConnectorFound | ConnectorMiss;
/** Thrown for network/HTTP failures (=> outcome 'unreachable', retried later). Never for "product not in source". */
export class Unreachable extends Error {}
export interface Connector {
  id: string; name: string; license: string; isMock: boolean;
  lookupBarcode(code: string): Promise<ConnectorResult>;
  /** CP05 (optional): full-text search. Results are only POSSIBLE matches — never an identity proof. */
  searchByName?(q: { name: string; brand?: string }): Promise<SearchHit[]>;
}
export interface SearchHit { code: string; name: string; brand: string; size: string; has_image: boolean; source_url: string }
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
