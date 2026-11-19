/** Reads a detached copy of the bytes. */
export declare function readBytes(path: string): Promise<Uint8Array>
/** Streams chunks under caller-controlled backpressure. */
export declare function streamBytes(path: string): AsyncIterable<Uint8Array>
