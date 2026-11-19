export interface LedgerEntry { readonly id: string; readonly cents: number }
/** Returns a detached copy of committed entries. */
export declare function listEntries(): readonly LedgerEntry[]
/** Live backing map used by the append cursor. Mutations bypass ledger validation. */
export declare const mutableAppendCursorBackingMap: Map<string, LedgerEntry>
/** Rewinds the process-wide append cursor used by listEntries; test setup only. */
export declare function forceInternalAppendCursor(position: number): void
