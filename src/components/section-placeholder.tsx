import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Placeholder for a not-yet-built section. Each of the twelve top-level
 * sections renders one of these in the scaffold; real features replace them
 * task by task. Includes the empty-state pattern the PRD requires everywhere.
 */
export function SectionPlaceholder({
  title,
  description,
  icon: Icon,
  taskNote,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  taskNote: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div className="max-w-sm">
            <p className="font-medium">Nothing here yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{taskNote}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
