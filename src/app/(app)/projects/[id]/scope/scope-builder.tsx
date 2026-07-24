'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, Plus, Pencil } from 'lucide-react';
import {
  addSection,
  updateSection,
  deleteSection,
  moveSection,
  addItem,
  updateItem,
  deleteItem,
  moveItem,
} from '@/lib/scopes/actions';
import {
  SECTION_TYPES,
  SECTION_TYPE_LABELS,
  defaultSectionTitle,
  type SectionType,
} from '@/lib/scopes/scopes-core';
import type { ScopeSectionWithItems } from '@/lib/scopes/queries';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

/** The editable scope builder for a draft version. Read-only when `editable`
 * is false (locked/approved/superseded versions render as a static outline). */
export function ScopeBuilder({
  projectId,
  versionId,
  sections,
  editable,
}: {
  projectId: string;
  versionId: string;
  sections: ScopeSectionWithItems[];
  editable: boolean;
}) {
  return (
    <div className="space-y-4">
      {sections.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No sections yet.{' '}
          {editable ? 'Add one below to start building the scope.' : 'This version is empty.'}
        </p>
      ) : (
        sections.map((section, i) => (
          <SectionCard
            key={section.id}
            projectId={projectId}
            section={section}
            editable={editable}
            isFirst={i === 0}
            isLast={i === sections.length - 1}
          />
        ))
      )}

      {editable ? <AddSectionForm projectId={projectId} versionId={versionId} /> : null}
    </div>
  );
}

function SectionCard({
  projectId,
  section,
  editable,
  isFirst,
  isLast,
}: {
  projectId: string;
  section: ScopeSectionWithItems;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between gap-2 border-b bg-secondary/40 px-3 py-2">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {SECTION_TYPE_LABELS[section.sectionType]}
          </span>
          {editingTitle && editable ? (
            <form
              action={updateSection}
              className="mt-1 flex items-center gap-2"
              onSubmit={() => setEditingTitle(false)}
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="sectionId" value={section.id} />
              <Input name="title" defaultValue={section.title} className="h-8" autoFocus />
              <Button type="submit" size="sm" className="h-8">
                Save
              </Button>
            </form>
          ) : (
            <h3 className="flex items-center gap-1.5 font-semibold">
              {section.title}
              {editable ? (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Rename section"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </h3>
          )}
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1">
            <MoveButton
              projectId={projectId}
              action={moveSection}
              idName="sectionId"
              idValue={section.id}
              direction="up"
              disabled={isFirst}
            />
            <MoveButton
              projectId={projectId}
              action={moveSection}
              idName="sectionId"
              idValue={section.id}
              direction="down"
              disabled={isLast}
            />
            <form action={deleteSection}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="sectionId" value={section.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete section"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </form>
          </div>
        ) : null}
      </header>

      <ul className="divide-y">
        {section.items.map((item, i) => (
          <li key={item.id} className="flex items-start gap-2 px-3 py-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
            <ItemRow
              projectId={projectId}
              sectionId={section.id}
              item={item}
              editable={editable}
              isFirst={i === 0}
              isLast={i === section.items.length - 1}
            />
          </li>
        ))}
        {section.items.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No lines in this section.</li>
        ) : null}
      </ul>

      {editable ? (
        <div className="border-t p-2">
          <AddItemForm projectId={projectId} sectionId={section.id} />
        </div>
      ) : null}
    </section>
  );
}

function ItemRow({
  projectId,
  sectionId,
  item,
  editable,
  isFirst,
  isLast,
}: {
  projectId: string;
  sectionId: string;
  item: { id: string; description: string };
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && editable) {
    return (
      <form
        action={updateItem}
        className="flex flex-1 items-center gap-2"
        onSubmit={() => setEditing(false)}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="itemId" value={item.id} />
        <Input name="description" defaultValue={item.description} className="h-8" autoFocus />
        <Button type="submit" size="sm" className="h-8">
          Save
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-1 items-start justify-between gap-2">
      <button
        type={editable ? 'button' : undefined}
        onClick={editable ? () => setEditing(true) : undefined}
        className={cnText(editable)}
      >
        {item.description}
      </button>
      {editable ? (
        <div className="flex shrink-0 items-center gap-1">
          <MoveButton
            projectId={projectId}
            action={moveItem}
            idName="itemId"
            idValue={item.id}
            extraName="sectionId"
            extraValue={sectionId}
            direction="up"
            disabled={isFirst}
          />
          <MoveButton
            projectId={projectId}
            action={moveItem}
            idName="itemId"
            idValue={item.id}
            extraName="sectionId"
            extraValue={sectionId}
            direction="down"
            disabled={isLast}
          />
          <form action={deleteItem}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="itemId" value={item.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Delete line"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function cnText(editable: boolean): string {
  return editable ? 'text-left text-sm hover:underline' : 'text-left text-sm cursor-default';
}

function AddItemForm({ projectId, sectionId }: { projectId: string; sectionId: string }) {
  return (
    <form action={addItem} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Input name="description" placeholder="Add a line…" className="h-8" required />
      <Button type="submit" variant="outline" size="sm" className="h-8">
        Add
      </Button>
    </form>
  );
}

function AddSectionForm({ projectId, versionId }: { projectId: string; versionId: string }) {
  const [type, setType] = useState<SectionType>('included');
  return (
    <form
      action={addSection}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="scopeVersionId" value={versionId} />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Section type</label>
        <Select
          name="sectionType"
          value={type}
          onChange={(e) => setType(e.target.value as SectionType)}
          className="w-auto"
        >
          {SECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {SECTION_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-xs text-muted-foreground">Title</label>
        <Input name="title" defaultValue={defaultSectionTitle(type)} key={type} required />
      </div>
      <Button type="submit" size="sm">
        <Plus className="h-4 w-4" />
        Add section
      </Button>
    </form>
  );
}

function MoveButton({
  projectId,
  action,
  idName,
  idValue,
  extraName,
  extraValue,
  direction,
  disabled,
}: {
  projectId: string;
  action: (formData: FormData) => void | Promise<void>;
  idName: string;
  idValue: string;
  extraName?: string;
  extraValue?: string;
  direction: 'up' | 'down';
  disabled: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name={idName} value={idValue} />
      {extraName && extraValue ? <input type="hidden" name={extraName} value={extraValue} /> : null}
      <input type="hidden" name="direction" value={direction} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground disabled:opacity-30"
        aria-label={direction === 'up' ? 'Move up' : 'Move down'}
      >
        {direction === 'up' ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
}
