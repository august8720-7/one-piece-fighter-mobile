import { TITLE_CHARACTER_IDS } from '../src/render/ui/titleRoster';

interface MenuUiArt { image: string; enabled?: boolean }
interface DeliveredFile { file: string }

/** Only menu art and its small preview sounds; fighter payloads wait for selection. */
export function menuPreloadFiles(
  records: Readonly<Record<string, DeliveredFile>>,
  uiCharacters: Readonly<Record<string, MenuUiArt>>,
  menuAudioFiles: readonly string[] = [],
): string[] {
  const logical = [
    'assets/stages/marineford/backdrop.webp',
    ...TITLE_CHARACTER_IDS.map(id => {
      const art = uiCharacters[id];
      if (!art || art.enabled === false) throw new Error(`Title art is unavailable: ${id}`);
      return art.image;
    }),
    ...menuAudioFiles,
  ];
  return [...new Set(logical.map(path => {
    const record = records[path];
    if (!record) throw new Error(`Missing menu preload asset: ${path}`);
    return record.file;
  }))];
}
