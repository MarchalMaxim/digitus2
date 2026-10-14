import { useState, type ChangeEvent, type DragEvent } from 'react';

export const NOT_A_SCORE_REFUSAL =
  'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).';

const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl', '.mid', '.midi'];

export interface DropZoneProps {
  onFile(name: string, bytes: Uint8Array): void;
  onRefuse(message: string): void;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Drag and drop plus a file chooser. Only MusicXML and MIDI get through (by extension, in any
 * case); anything else is refused with a notice.
 */
export function DropZone({ onFile, onRefuse }: DropZoneProps) {
  const [over, setOver] = useState(false);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!SCORE_EXTENSIONS.includes(extensionOf(file.name))) {
      onRefuse(NOT_A_SCORE_REFUSAL);
      return;
    }
    // A failed read (the file moved, or permission was lost) still ends in a notice, never silence.
    void file.arrayBuffer().then(
      (buffer) => onFile(file.name, new Uint8Array(buffer)),
      () => onRefuse(NOT_A_SCORE_REFUSAL),
    );
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!over) setOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Moving onto a child (the 'choose a file' label) bubbles a dragleave; only leaving the zone counts.
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    accept(e.dataTransfer?.files?.[0]);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    accept(input.files?.[0]);
    // Cleared so choosing the same file again still fires a change event.
    input.value = '';
  };

  return (
    <div
      data-testid="drop-zone"
      className={over ? 'drop-zone is-over' : 'drop-zone'}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      Drop a MusicXML or MIDI file here (.musicxml, .xml, .mxl, .mid or .midi), or{' '}
      <label className="file-choose">
        choose a file
        <input
          type="file"
          accept=".musicxml,.xml,.mxl,.mid,.midi"
          className="visually-hidden"
          onChange={onChange}
        />
      </label>
    </div>
  );
}
