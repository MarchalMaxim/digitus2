import { create } from 'zustand';

export interface LocalScoreSummary {
  id: string;
  name: string;
  /** What was saved: the score file itself, a recognised scan, or a scan still being worked on. */
  detail: 'file' | 'recognition' | 'corrected' | 'draft';
  saved: boolean;
  /**
   * What the Share column offers (issue 132): `can` Share, `again` Share after the shared library
   * had no such upload, `waiting` for the owner's review (Withdraw), or `shared`. Absent: nothing,
   * the row cannot be shared or has not been checked yet.
   */
  sharing?: 'can' | 'again' | 'waiting' | 'shared' | undefined;
}

/** Only small summaries enter React; source blobs stay in the lazy persistence module. */
export const useLocalLibrary = create<{
  items: LocalScoreSummary[];
  failed: boolean;
}>()(() => ({ items: [], failed: false }));
