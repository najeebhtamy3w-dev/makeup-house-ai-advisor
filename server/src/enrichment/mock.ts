import type { Connector } from './types.ts';
/** DEV/TEST ONLY. Clearly fake data (never presented as real). Enabled with MH_ENRICH=mock. */
const DATA: Record<string, Record<string, string>> = {
  '5901234123457': { name: 'Demo Gentle Moisturizer', brand: 'DemoBrand', size: '50 ml', ingredients: 'Aqua, Glycerin, Ceramide NP' },
  '4006381333931': { name: 'Demo Scented Cream', brand: 'DemoBrand', size: '75 ml', ingredients: 'Aqua, Parfum, Glycerin' },
};
export const mockConnector = (name = 'MOCK (بيانات تجريبية)'): Connector => ({
  id: 'mock', name, license: 'اختبار فقط', isMock: true,
  async lookupBarcode(code) { const d = DATA[code]; return d ? { found: true, fields: d, sourceUrl: '' } : { found: false }; },
});
