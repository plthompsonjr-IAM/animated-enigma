'use client';

import { useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { addCatalogLine, addLine, updateLine, deleteLine } from '@/lib/estimates/actions';
import {
  LINE_TYPES,
  LINE_TYPE_LABELS,
  computeLineCost,
  formatMoney,
  type LineType,
} from '@/lib/estimates/estimate-core';
import { UNITS, UNIT_ABBR, UNIT_LABELS, formatCost, type Unit } from '@/lib/catalog/catalog-core';
import type { EstimateLineRow } from '@/lib/estimates/queries';
import { LineTypeBadge } from '@/components/estimates/estimate-badges';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

export interface CatalogPick {
  id: string;
  name: string;
  unitCost: number;
  unit: Unit;
  trade: string | null;
}

export function EstimateBuilder({
  projectId,
  versionId,
  lines,
  catalog,
  editable,
}: {
  projectId: string;
  versionId: string;
  lines: EstimateLineRow[];
  catalog: CatalogPick[];
  editable: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
              <th className="px-3 py-2 text-right font-semibold">Line cost</th>
              {editable ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((line) => (
              <LineRow key={line.id} projectId={projectId} line={line} editable={editable} />
            ))}
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={editable ? 6 : 5}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No lines yet. Add from your catalog or enter one below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <CatalogAdd projectId={projectId} versionId={versionId} catalog={catalog} />
          <ManualAdd projectId={projectId} versionId={versionId} />
        </div>
      ) : null}
    </div>
  );
}

function LineRow({
  projectId,
  line,
  editable,
}: {
  projectId: string;
  line: EstimateLineRow;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && editable) {
    return (
      <tr className="bg-accent/30">
        <td colSpan={6} className="px-3 py-2">
          <form
            action={updateLine}
            className="flex flex-wrap items-end gap-2"
            onSubmit={() => setEditing(false)}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="lineId" value={line.id} />
            <FieldMini label="Description" className="min-w-[12rem] flex-1">
              <Input name="description" defaultValue={line.description} required />
            </FieldMini>
            <FieldMini label="Type">
              <Select name="lineType" defaultValue={line.lineType} className="w-auto">
                {LINE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LINE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </FieldMini>
            <FieldMini label="Qty">
              <Input
                name="quantity"
                type="number"
                min="0"
                step="0.01"
                defaultValue={line.quantity}
                className="w-20"
              />
            </FieldMini>
            <FieldMini label="Unit">
              <Select name="unit" defaultValue={line.unit} className="w-auto">
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_ABBR[u]}
                  </option>
                ))}
              </Select>
            </FieldMini>
            <FieldMini label="Unit cost">
              <Input
                name="unitCost"
                type="number"
                min="0"
                step="0.01"
                defaultValue={line.unitCost}
                className="w-24"
              />
            </FieldMini>
            <FieldMini label="Waste %">
              <Input
                name="wasteFactorPct"
                type="number"
                min="0"
                max="100"
                step="0.5"
                defaultValue={line.wasteFactorPct ? String(Number(line.wasteFactorPct) * 100) : '0'}
                className="w-20"
              />
            </FieldMini>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                name="taxable"
                value="true"
                defaultChecked={line.taxable}
                className="h-4 w-4"
              />
              Taxable
            </label>
            <div className="flex items-center gap-1.5">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  const lineCost = computeLineCost(line);
  return (
    <tr className="hover:bg-accent/30">
      <td className="px-3 py-2">
        <div className="font-medium">{line.description}</div>
        {line.category ? (
          <div className="text-xs text-muted-foreground">{line.category}</div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <LineTypeBadge type={line.lineType as LineType} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {Number(line.quantity)} {UNIT_ABBR[line.unit]}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatCost(line.unitCost)}
      </td>
      <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(lineCost)}</td>
      {editable ? (
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setEditing(true)}
              aria-label="Edit line"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <form action={deleteLine}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="lineId" value={line.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete line"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function CatalogAdd({
  projectId,
  versionId,
  catalog,
}: {
  projectId: string;
  versionId: string;
  catalog: CatalogPick[];
}) {
  if (catalog.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No catalog items yet. Add some in the cost catalog to pull from here.
      </div>
    );
  }
  return (
    <form action={addCatalogLine} className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Add from catalog
      </p>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="estimateVersionId" value={versionId} />
      <Select name="catalogItemId" defaultValue={catalog[0]?.id} aria-label="Catalog item">
        {catalog.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {formatCost(c.unitCost)} / {UNIT_ABBR[c.unit]}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-2">
        <Input
          name="quantity"
          type="number"
          min="0"
          step="0.01"
          defaultValue="1"
          className="w-24"
          aria-label="Quantity"
        />
        <Button type="submit" size="sm">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
    </form>
  );
}

function ManualAdd({ projectId, versionId }: { projectId: string; versionId: string }) {
  return (
    <form action={addLine} className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Add a line
      </p>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="estimateVersionId" value={versionId} />
      <Input name="description" placeholder="Description" required />
      <div className="flex flex-wrap items-end gap-2">
        <Select name="lineType" defaultValue="material" aria-label="Type" className="w-auto">
          {LINE_TYPES.map((t) => (
            <option key={t} value={t}>
              {LINE_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Input
          name="quantity"
          type="number"
          min="0"
          step="0.01"
          defaultValue="1"
          className="w-20"
          aria-label="Quantity"
        />
        <Select name="unit" defaultValue="each" aria-label="Unit" className="w-auto">
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </Select>
        <Input
          name="unitCost"
          type="number"
          min="0"
          step="0.01"
          placeholder="Unit $"
          className="w-24"
          aria-label="Unit cost"
        />
        <Button type="submit" size="sm">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
    </form>
  );
}

function FieldMini({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
