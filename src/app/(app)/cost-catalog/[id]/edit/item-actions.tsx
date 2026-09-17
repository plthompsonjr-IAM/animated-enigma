'use client';

import { setCatalogItemActive, deleteCatalogItem } from '@/lib/catalog/actions';
import { Button } from '@/components/ui/button';

/** Activate/deactivate + delete controls on the edit page (own items only). */
export function ItemActions({ itemId, isActive }: { itemId: string; isActive: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <form action={setCatalogItemActive}>
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="active" value={(!isActive).toString()} />
        <Button type="submit" variant="outline" size="sm">
          {isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </form>
      <form action={deleteCatalogItem}>
        <input type="hidden" name="itemId" value={itemId} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          Delete
        </Button>
      </form>
    </div>
  );
}
