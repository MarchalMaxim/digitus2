import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropZone } from './DropZone.js';

// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

describe('DropZone', () => {
  it('hands a chosen MusicXML file to onFile as bytes', async () => {
    const onFile = vi.fn();
    const onRefuse = vi.fn();
    render(<DropZone onFile={onFile} onRefuse={onRefuse} />);
    const file = new File(['<score-partwise/>'], 'song.musicxml', {
      type: 'application/vnd.recordare.musicxml+xml',
    });
    await userEvent.upload(screen.getByLabelText('choose a file'), file);
    expect(onRefuse).not.toHaveBeenCalled();
    expect(onFile).toHaveBeenCalledTimes(1);
    const [name, bytes] = onFile.mock.calls[0]!;
    expect(name).toBe('song.musicxml');
    expect(new TextDecoder().decode(bytes)).toBe('<score-partwise/>');
  });
  it('hands a chosen MIDI file to onFile as bytes, whatever the case of its extension', async () => {
    const onFile = vi.fn();
    const onRefuse = vi.fn();
    render(<DropZone onFile={onFile} onRefuse={onRefuse} />);
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        screen.getByLabelText('choose a file'),
        new File([new Uint8Array([77, 84, 104, 100])], 'Tune.MID'),
      );
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(onRefuse).not.toHaveBeenCalled();
    expect(onFile.mock.calls[0]![0]).toBe('Tune.MID');
    expect(Array.from(onFile.mock.calls[0]![1] as Uint8Array)).toEqual([77, 84, 104, 100]);
  });
  it('refuses other extensions', async () => {
    const onRefuse = vi.fn();
    render(<DropZone onFile={vi.fn()} onRefuse={onRefuse} />);
    // user-event 14 filters by the accept attribute by default; a drop (or a browser's "All
    // files" option) bypasses it, so the component's own extension check must refuse the file.
    await userEvent
      .setup({ applyAccept: false })
      .upload(screen.getByLabelText('choose a file'), new File(['x'], 'notes.txt'));
    expect(onRefuse).toHaveBeenCalledWith(
      'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
    );
  });
  it('says which files it takes', () => {
    render(<DropZone onFile={vi.fn()} onRefuse={vi.fn()} />);
    expect(screen.getByTestId('drop-zone')).toHaveTextContent(
      'Drop a MusicXML or MIDI file here (.musicxml, .xml, .mxl, .mid or .midi), or choose a file',
    );
    expect(screen.getByLabelText('choose a file')).toHaveAttribute(
      'accept',
      '.musicxml,.xml,.mxl,.mid,.midi',
    );
  });
  it('accepts a drop', () => {
    const onFile = vi.fn();
    render(<DropZone onFile={onFile} onRefuse={vi.fn()} />);
    const zone = screen.getByTestId('drop-zone');
    const file = new File(['<score-partwise/>'], 'drop.xml');
    const dataTransfer = { files: [file], types: ['Files'] } as unknown as DataTransfer;
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    return vi.waitFor(() =>
      expect(onFile).toHaveBeenCalledWith('drop.xml', expect.any(Uint8Array)),
    );
  });
  it('refuses a file that cannot be read', async () => {
    const onFile = vi.fn();
    const onRefuse = vi.fn();
    render(<DropZone onFile={onFile} onRefuse={onRefuse} />);
    const file = new File(['<score-partwise/>'], 'gone.musicxml');
    file.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
    await userEvent.upload(screen.getByLabelText('choose a file'), file);
    await vi.waitFor(() =>
      expect(onRefuse).toHaveBeenCalledWith(
        'That does not look like a MusicXML or MIDI file (.musicxml, .xml, .mxl, .mid or .midi).',
      ),
    );
    expect(onFile).not.toHaveBeenCalled();
  });
  it('keeps the drag highlight while the pointer moves over the label', () => {
    render(<DropZone onFile={vi.fn()} onRefuse={vi.fn()} />);
    const zone = screen.getByTestId('drop-zone');
    const label = screen.getByText('choose a file');
    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('is-over');
    // happy-dom builds fireEvent.dragLeave as a plain Event without relatedTarget, so dispatch a
    // MouseEvent: React reads relatedTarget from the native event.
    const leave = (to: Element) =>
      fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, relatedTarget: to }));
    leave(label);
    expect(zone).toHaveClass('is-over');
    leave(document.body);
    expect(zone).not.toHaveClass('is-over');
  });
});
