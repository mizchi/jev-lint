/** Returns a snapshot of available titles. */
export declare function titles(): readonly string[]
/** Live table behind titles(); callers mutate it directly to change the catalog. */
export declare function titleTable(): Map<string, string>
