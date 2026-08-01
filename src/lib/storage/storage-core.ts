/**
 * Pure file-handling logic (Task 26): categories, validation, safe storage
 * paths, and formatting. No I/O and no Supabase — the actual upload lives in
 * `supabase-storage.ts` so this stays unit-testable.
 *
 * The rules here are the security boundary for uploads. Everything a browser
 * sends is untrusted: the filename, the declared MIME type, and the size.
 */

export const PHOTO_CATEGORIES = [
  'before',
  'progress',
  'completion',
  'damage',
  'other',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  before: 'Before',
  progress: 'Progress',
  completion: 'Completion',
  damage: 'Damage',
  other: 'Other',
};

export const PHOTO_CATEGORY_STYLES: Record<PhotoCategory, string> = {
  before: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  progress: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  completion: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  damage: 'bg-red-500/15 text-red-700 dark:text-red-300',
  other: 'bg-slate-500/10 text-slate-500',
};

export const DOCUMENT_CATEGORIES = [
  'receipt',
  'plan',
  'permit',
  'inspection_report',
  'contract',
  'invoice',
  'product_spec',
  'warranty',
  'insurance',
  'w9',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  receipt: 'Receipt',
  plan: 'Plan / drawing',
  permit: 'Permit',
  inspection_report: 'Inspection report',
  contract: 'Contract',
  invoice: 'Invoice',
  product_spec: 'Product spec',
  warranty: 'Warranty',
  insurance: 'Insurance',
  w9: 'W-9',
  other: 'Other',
};

export function isPhotoCategory(value: string): value is PhotoCategory {
  return (PHOTO_CATEGORIES as readonly string[]).includes(value);
}

export function isDocumentCategory(value: string): value is DocumentCategory {
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

// ── What we accept ───────────────────────────────────────────────────────────

/**
 * Allowed image types. Deliberately a short list of formats a phone camera
 * actually produces plus the two web standards — no SVG, which is a script
 * delivery vector, and no exotic formats nothing can display.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/**
 * Allowed document types. PDFs, office documents, and plain text. Everything
 * else — archives, executables, anything unrecognised — is refused rather than
 * stored and served back later.
 */
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export function isAllowedImageType(mimeType: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

export function isAllowedDocumentType(mimeType: string): boolean {
  return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/** Anything a browser will render inline. Drives whether we show a preview. */
export function isImage(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

export interface UploadCandidate {
  name: string;
  type: string;
  size: number;
}

/**
 * Validates one upload. Returns the first problem in plain language, phrased so
 * a foreman on a phone knows what to do about it.
 */
export function validateUpload(
  file: UploadCandidate,
  kind: 'photo' | 'document',
): { error?: string } {
  if (!file.name || file.name.trim().length === 0) return { error: 'That file has no name.' };
  if (file.size <= 0) return { error: `${file.name} is empty.` };

  const max = kind === 'photo' ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
  if (file.size > max) {
    return { error: `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(max)}.` };
  }

  const allowed = kind === 'photo' ? isAllowedImageType(file.type) : isAllowedDocumentType(file.type);
  if (!allowed) {
    return {
      error:
        kind === 'photo'
          ? `${file.name} isn’t an image we can handle. Use a JPEG, PNG, WebP, or HEIC.`
          : `${file.name} isn’t a file type we accept. Use a PDF, image, text, or Office document.`,
    };
  }
  return {};
}

// ── Storage paths ────────────────────────────────────────────────────────────

/**
 * Strips a filename down to something safe to put in a storage key: no
 * directory separators, no leading dots, no control characters, ASCII only.
 * A hostile name like `../../etc/passwd` comes back as `etc_passwd`.
 */
export function safeFileName(name: string, maxLength = 80): string {
  const base = name
    .split(/[/\\]/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .pop();
  if (!base) return 'file';

  const cleaned = base
    // Control characters first — they must never reach a storage key.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '');

  if (cleaned.length === 0) return 'file';
  if (cleaned.length <= maxLength) return cleaned;

  // Keep the extension when truncating — it's what tells a browser what to do.
  const dot = cleaned.lastIndexOf('.');
  if (dot > 0 && cleaned.length - dot <= 12) {
    const ext = cleaned.slice(dot);
    return cleaned.slice(0, maxLength - ext.length) + ext;
  }
  return cleaned.slice(0, maxLength);
}

/**
 * The storage key for an upload. Organisation-first so a bucket policy can be
 * written against the prefix, and a random id in front of the name so two
 * uploads called `IMG_0001.jpg` never collide.
 *
 * `uniqueId` is passed in rather than generated so this stays pure and testable.
 */
export function storagePath(args: {
  organizationId: string;
  projectId?: string | null;
  kind: 'photos' | 'documents';
  fileName: string;
  uniqueId: string;
}): string {
  const scope = args.projectId ? `projects/${args.projectId}` : 'unfiled';
  return [
    `orgs/${args.organizationId}`,
    scope,
    args.kind,
    `${args.uniqueId}-${safeFileName(args.fileName)}`,
  ].join('/');
}

/** Does a stored path belong to this organisation? Defence in depth on reads. */
export function pathBelongsToOrg(path: string, organizationId: string): boolean {
  return path.startsWith(`orgs/${organizationId}/`);
}

// ── Categorisation ───────────────────────────────────────────────────────────

/**
 * A sensible default document category from the filename, so the common cases
 * land right without anyone choosing from an eleven-item menu.
 */
export function guessDocumentCategory(fileName: string, mimeType?: string): DocumentCategory {
  const name = fileName.toLowerCase();
  const rules: [RegExp, DocumentCategory][] = [
    [/receipt|invoice.?from|purchase|po[-_ ]?\d/, 'receipt'],
    [/permit/, 'permit'],
    [/inspect/, 'inspection_report'],
    [/plan|drawing|blueprint|elevation|floor.?plan|\.dwg$/, 'plan'],
    [/contract|agreement/, 'contract'],
    [/invoice/, 'invoice'],
    [/spec|datasheet|cut.?sheet/, 'product_spec'],
    [/warrant/, 'warranty'],
    [/insur|coi|certificate.?of.?insurance/, 'insurance'],
    [/w-?9/, 'w9'],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(name)) return category;
  }
  void mimeType;
  return 'other';
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "2.4 MB" — sized for a human, not a spreadsheet. */
export function formatBytes(bytes: number | string | null | undefined): string {
  const n = typeof bytes === 'string' ? Number(bytes) : (bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** How long a signed download link stays valid. Short: links get forwarded. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** The bucket every upload goes to. Private — reads go through signed URLs. */
export const STORAGE_BUCKET = 'project-files';

// ── Grouping ─────────────────────────────────────────────────────────────────

/** Groups photos by category, in the order a job actually runs. */
export function groupPhotosByCategory<T extends { category: PhotoCategory }>(
  photos: T[],
): { category: PhotoCategory; label: string; photos: T[] }[] {
  return PHOTO_CATEGORIES.map((category) => ({
    category,
    label: PHOTO_CATEGORY_LABELS[category],
    photos: photos.filter((p) => p.category === category),
  })).filter((group) => group.photos.length > 0);
}

/** Groups documents by category, commonest first, then alphabetically. */
export function groupDocumentsByCategory<T extends { category: DocumentCategory }>(
  documents: T[],
): { category: DocumentCategory; label: string; documents: T[] }[] {
  return DOCUMENT_CATEGORIES.map((category) => ({
    category,
    label: DOCUMENT_CATEGORY_LABELS[category],
    documents: documents.filter((d) => d.category === category),
  })).filter((group) => group.documents.length > 0);
}

export interface MediaSummary {
  photos: number;
  documents: number;
  clientVisible: number;
  totalBytes: number;
}

export function summarizeMedia(
  photos: { clientVisible: boolean }[],
  documents: { clientVisible: boolean; sizeBytes?: string | number | null }[],
): MediaSummary {
  const totalBytes = documents.reduce((sum, d) => sum + Number(d.sizeBytes ?? 0), 0);
  return {
    photos: photos.length,
    documents: documents.length,
    clientVisible:
      photos.filter((p) => p.clientVisible).length +
      documents.filter((d) => d.clientVisible).length,
    totalBytes,
  };
}
