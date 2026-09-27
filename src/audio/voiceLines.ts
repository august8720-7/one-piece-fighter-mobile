import manifest from './voiceLines0922.json';
interface VoiceLine { file: string; label: string; translation: string; transcriptVerified: boolean }

/** The exact chosen file, not a separately randomized subtitle, owns the wording. */
export function voiceLine(file: string): { text: string; transcriptVerified: boolean } {
  const line = (manifest.lines as VoiceLine[]).find(entry => entry.file === file);
  return line?.transcriptVerified
    ? { text: line.translation, transcriptVerified: true }
    : { text: line?.label ?? '', transcriptVerified: false };
}
