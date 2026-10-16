import { create } from 'zustand';

export interface LocalScoreSummary {
  id: string;
  name: string;
  detail: string;
  saved: boolean;
}

/** Only small summaries enter React; source blobs stay in the lazy persistence module. */
export const useLocalLibrary = create<{
  items: LocalScoreSummary[];
  failed: boolean;
}>()(() => ({ items: [], failed: false }));
