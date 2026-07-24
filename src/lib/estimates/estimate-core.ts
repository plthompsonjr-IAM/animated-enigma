/**
 * Pure estimating logic (Task 16): the line-cost and estimate roll-up engine
 * (the "EstimateService"), line-type catalog, and formatting. No I/O — this is
 * the money math, so it is exhaustively unit-tested. The version lifecycle is
 * the shared scope/estimate/proposal model, re-exported from scopes-core.
 */

import { toNum } from '@/lib/catalog/catalog-core';

export {
  canTransition,
  allowedTransitions,
  isEditable,
  isFrozen,
  VERSION_STATUS_LABELS,
  VERSION_STATUS_STYLES,
  type VersionStatus,
} from '@/lib/scopes/scopes-core';

export const LINE_TYPES = [
  'labor',
  'material',
  'equipment',
  'subcontractor',
  'allowance',
  'other',
] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const LINE_TYPE_LABELS: Record<LineType, string> = {
  labor: 'Labor',
  material: 'Material',
  equipment: 'Equipment',
  subcontractor: 'Subcontractor',
  allowance: 'Allowance',
  other: 'Other',
};

export const LINE_TYPE_STYLES: Record<LineType, string> = {
  labor: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  material: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  equipment: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  subcontractor: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  allowance: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  other: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
};

// ── Line + estimate math ─────────────────────────────────────────────────────

export interface EstimateLineInput {
  lineType: LineType;
  quantity: string | number | null;
  unitCost: string | number | null;
  wasteFactorPct: string | number | null;
  taxable?: boolean;
}

/** Extended cost for one line: quantity × unit cost × (1 + waste). Rounded to cents. */
export function computeLineCost(line: EstimateLineInput): number {
  const raw = toNum(line.quantity) * toNum(line.unitCost) * (1 + toNum(line.wasteFactorPct));
  return round2(raw);
}

export interface EstimateRates {
  /** Fractions, e.g. 0.10 for 10%. */
  overheadPct: string | number | null;
  profitPct: string | number | null;
  taxRate: string | number | null;
}

export interface EstimateTotals {
  materialSubtotal: number;
  laborSubtotal: number;
  equipmentSubtotal: number;
  subcontractorSubtotal: number;
  otherSubtotal: number;
  directCost: number;
  overheadAmount: number;
  profitAmount: number;
  priceBeforeTax: number;
  taxAmount: number;
  finalPrice: number;
  grossMarginPct: number;
  markupPct: number;
}

/**
 * Roll a set of lines up to a client-ready price:
 *   direct cost = Σ line costs (grouped into per-type subtotals)
 *   overhead    = direct cost × overhead%
 *   profit      = (direct cost + overhead) × profit%
 *   price       = direct cost + overhead + profit
 *   tax         = tax% × the taxable share of price (allocated pro-rata by cost)
 *   final       = price + tax
 *   margin      = (price − direct cost) / price   (tax is a pass-through)
 */
export function computeEstimate(lines: EstimateLineInput[], rates: EstimateRates): EstimateTotals {
  let material = 0;
  let labor = 0;
  let equipment = 0;
  let subcontractor = 0;
  let other = 0;
  let taxableCost = 0;

  for (const line of lines) {
    const cost = computeLineCost(line);
    switch (line.lineType) {
      case 'material':
        material += cost;
        break;
      case 'labor':
        labor += cost;
        break;
      case 'equipment':
        equipment += cost;
        break;
      case 'subcontractor':
        subcontractor += cost;
        break;
      default:
        other += cost;
    }
    if (line.taxable !== false) taxableCost += cost;
  }

  const directCost = round2(material + labor + equipment + subcontractor + other);
  const overheadAmount = round2(directCost * toNum(rates.overheadPct));
  const profitAmount = round2((directCost + overheadAmount) * toNum(rates.profitPct));
  const priceBeforeTax = round2(directCost + overheadAmount + profitAmount);

  // Allocate the marked-up price to the taxable share of direct cost, then tax it.
  const taxableFraction = directCost > 0 ? taxableCost / directCost : 0;
  const taxAmount = round2(priceBeforeTax * taxableFraction * toNum(rates.taxRate));
  const finalPrice = round2(priceBeforeTax + taxAmount);

  const grossMarginPct =
    priceBeforeTax > 0 ? round4((priceBeforeTax - directCost) / priceBeforeTax) : 0;
  const markupPct = directCost > 0 ? round4((priceBeforeTax - directCost) / directCost) : 0;

  return {
    materialSubtotal: round2(material),
    laborSubtotal: round2(labor),
    equipmentSubtotal: round2(equipment),
    subcontractorSubtotal: round2(subcontractor),
    otherSubtotal: round2(other),
    directCost,
    overheadAmount,
    profitAmount,
    priceBeforeTax,
    taxAmount,
    finalPrice,
    grossMarginPct,
    markupPct,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatMoney(value: string | number | null | undefined): string {
  const n = toNum(value ?? 0);
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

/** A stored margin/markup fraction as a percent string, e.g. 0.35 → "35%". */
export function formatMarginPct(fraction: string | number | null | undefined): string {
  const n = toNum(fraction) * 100;
  return `${Math.round((n + Number.EPSILON) * 10) / 10}%`;
}

/** Ordering helpers reused across scope/estimate builders. */
export function nextSortOrder(items: { sortOrder: number }[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map((i) => i.sortOrder)) + 1;
}

export function isLineType(value: string): value is LineType {
  return (LINE_TYPES as readonly string[]).includes(value);
}
