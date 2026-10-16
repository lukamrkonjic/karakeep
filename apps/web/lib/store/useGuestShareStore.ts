import { create } from "zustand";

/**
 * Fork: Share with a guest… — open from the profile menu, the phone's More
 * or a list's "…" (`listId`: that list goes into the link). The dialog
 * itself is mounted once, in the dashboard's layout (GuestShareDialog).
 */
export const useGuestShareStore = create<{
  open: boolean;
  listId: string | null;
  show: (listId?: string) => void;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  listId: null,
  show: (listId) => set({ open: true, listId: listId ?? null }),
  setOpen: (open) => set(open ? { open } : { open, listId: null }),
}));
