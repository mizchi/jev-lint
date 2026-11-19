/** Returns a detached copy of the frame's RGBA bytes. */
export declare function copyPixels(): Uint8Array
/** Zero-copy editing API for external filter plugins. Writes update the frame; the view expires at the next render. */
export declare function mapPixels(): Uint8Array
