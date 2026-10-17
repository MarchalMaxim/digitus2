import { create } from 'zustand';

export interface LocalScoreSummary {
  id: string;
  name: string;
  /** What was saved: the score file itself, a recognised scan, or a scan still being worked on. */
  detail: 'file' | 'recognition' | 'draft';
  saved: boolean;
}

/** Only small summaries enter React; source blobs stay in the lazy persistence module. */
export const useLocalLibrary = create<{
  items: LocalScoreSummary[];
  failed: boolean;
}>()(() => ({ items: [], failed: false }));
