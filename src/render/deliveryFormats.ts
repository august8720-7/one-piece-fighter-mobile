export interface DeliveryRecord {
  file: string;
  sha256: string;
  bytes: number;
  contentType: string;
  source: string;
  sourceSha256: string;
  preserveRgba?: boolean;
  slice?: { offset: number; length: number };
}
export interface DeliveryDefinition extends DeliveryRecord { avif?: DeliveryRecord }
export type DeliveryFormat = 'webp' | 'avif';

/** One logical page, one physical file. Runtime geometry keeps its existing names. */
export function resolveDeliveryRecords(definitions: Readonly<Record<string, DeliveryDefinition>>, format: DeliveryFormat): Readonly<Record<string, DeliveryRecord>> {
  return Object.freeze(Object.fromEntries(Object.entries(definitions).map(([logical, definition]) => {
    if (definition.avif && (!/^assets\/characters\/[a-z0-9_]+\/anime\/atlas(?:-p\d+)?\.webp$/.test(logical)
      || definition.contentType !== 'image/webp' || definition.avif.contentType !== 'image/avif'
      || definition.slice || definition.avif.slice || definition.preserveRgba
      || definition.avif.source !== definition.source || definition.avif.sourceSha256 !== definition.sourceSha256)) {
      throw new Error(`Invalid alternate atlas record: ${logical}`);
    }
    const selected: DeliveryDefinition = { ...(format === 'avif' && definition.avif ? definition.avif : definition) };
    delete selected.avif;
    return [logical, Object.freeze(selected)];
  })));
}

/** Lock once before any pool consumes records; late probes can never change MIME/hash. */
export class DeliveryFormatSelection {
  private selected: DeliveryFormat | null = null;
  private pending: Promise<DeliveryFormat> | null = null;
  private finish: ((format: DeliveryFormat) => void) | null = null;
  private readonly maps: Record<DeliveryFormat, Readonly<Record<string, DeliveryRecord>>>;
  private readonly hasAvif: boolean;

  constructor(definitions: Readonly<Record<string, DeliveryDefinition>>) {
    this.hasAvif = Object.values(definitions).some(record => !!record.avif);
    // A single-format manifest already is the original flat lookup table.
    this.maps = this.hasAvif ? { webp: resolveDeliveryRecords(definitions, 'webp'), avif: resolveDeliveryRecords(definitions, 'avif') }
      : { webp: definitions, avif: definitions };
  }

  records(): Readonly<Record<string, DeliveryRecord>> {
    if (!this.selected) {
      this.finish?.('webp');
      this.selected ??= 'webp';
    }
    return this.maps[this.selected];
  }

  prepare(probe: (signal: AbortSignal) => Promise<boolean>, timeoutMs = 300, forceWebp = false): Promise<DeliveryFormat> {
    if (this.selected) return Promise.resolve(this.selected);
    if (this.pending) return this.pending;
    if (!this.hasAvif || forceWebp) { this.selected = 'webp'; return Promise.resolve('webp'); }
    this.pending = new Promise(resolve => {
      const controller = new AbortController();
      const complete = (format: DeliveryFormat): void => {
        this.selected ??= format;
        clearTimeout(timer);
        this.finish = null;
        controller.abort();
        resolve(this.selected);
      };
      const timer = setTimeout(() => complete('webp'), timeoutMs);
      this.finish = complete;
      void Promise.resolve().then(() => probe(controller.signal)).then(ok => complete(ok ? 'avif' : 'webp'), () => complete('webp'));
    });
    return this.pending;
  }
}
