/**
 * Pure cost-catalog logic (Task 15): units/tiers, numeric coercion, and the
 * unit-cost roll-up an estimate line is built from. No I/O — unit-testable and
 * shared by forms, actions, queries, and (in Task 16) the estimate builder.
 *
 * Costs are stored as numeric strings; `waste_pct` is a fraction (0.05 = 5%).
 */

export const UNITS = [
  'each',
  'linear_foot',
  'square_foot',
  'cubic_yard',
  'hour',
  'day',
  'allowance',
  'lump_sum',
] as const;
export type Unit = (typeof UNITS)[number];

export const UNIT_LABELS: Record<Unit, string> = {
  each: 'Each',
  linear_foot: 'Linear foot',
  square_foot: 'Square foot',
  cubic_yard: 'Cubic yard',
  hour: 'Hour',
  day: 'Day',
  allowance: 'Allowance',
  lump_sum: 'Lump sum',
};

/** Short unit suffix for compact display, e.g. "$4.50 / LF". */
export const UNIT_ABBR: Record<Unit, string> = {
  each: 'ea',
  linear_foot: 'LF',
  square_foot: 'SF',
  cubic_yard: 'CY',
  hour: 'hr',
  day: 'day',
  allowance: 'allow',
  lump_sum: 'LS',
};

export const TIERS = ['economic', 'standard', 'premium'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  economic: 'Economic',
  standard: 'Standard',
  premium: 'Premium',
};

export const TIER_STYLES: Record<Tier, string> = {
  economic: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  standard: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  premium: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
};

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

// ── Numeric helpers ──────────────────────────────────────────────────────────

/** Coerce a numeric-string / number / null into a finite number (0 otherwise). */
export function toNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export interface CostInputs {
  defaultMaterialCost?: string | number | null;
  defaultLaborHours?: string | number | null;
  defaultLaborRate?: string | number | null;
  equipmentCost?: string | number | null;
  /** Fraction, e.g. 0.05 for 5%. */
  wastePct?: string | number | null;
}

export interface UnitCostBreakdown {
  material: number;
  labor: number;
  equipment: number;
  total: number;
}

/**
 * The fully-loaded cost for one unit of a catalog item:
 *   material × (1 + waste) + labor_hours × labor_rate + equipment.
 * This is the per-unit basis the estimate multiplies by quantity.
 */
export function computeUnitCost(item: CostInputs): UnitCostBreakdown {
  const material = toNum(item.defaultMaterialCost) * (1 + toNum(item.wastePct));
  const labor = toNum(item.defaultLaborHours) * toNum(item.defaultLaborRate);
  const equipment = toNum(item.equipmentCost);
  const total = round2(material + labor + equipment);
  return {
    material: round2(material),
    labor: round2(labor),
    equipment: round2(equipment),
    total,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Currency display for catalog costs (2 decimals), blank for null/invalid. */
export function formatCost(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = toNum(value);
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

/** "$4.50 / LF" — unit cost with the unit abbreviation. */
export function formatUnitCost(total: number, unit: Unit): string {
  return `${total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / ${UNIT_ABBR[unit]}`;
}

/** Percent display of a stored fraction, e.g. 0.05 → "5%". */
export function formatPct(fraction: string | number | null | undefined): string {
  const n = toNum(fraction);
  if (n === 0) return '0%';
  return `${round2(n * 100)}%`;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export const CATALOG_SORTS = ['name', 'trade', 'cost_high', 'cost_low', 'recent'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  name: 'Name A–Z',
  trade: 'Trade',
  cost_high: 'Unit cost (high→low)',
  cost_low: 'Unit cost (low→high)',
  recent: 'Recently updated',
};
