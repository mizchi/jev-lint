import { createHash } from "node:crypto";

function checksumOf(entries) {
  const h = createHash("sha1");
  for (const e of entries) h.update(`${e.path}\0${e.size}\0`);
  return h.digest("hex");
}

export class Snapshot {
  constructor(label, entries, takenAt = new Date()) {
    this.label = label;
    this.entries = entries;
    this.takenAt = takenAt;
  }

  toJSON() {
    return {
      label: this.label,
      takenAt: this.takenAt.toISOString(),
      entries: this.entries.map((e) => ({ path: e.path, size: e.size })),
      checksum: checksumOf(this.entries),
    };
  }

  static fromJSON(obj) {
    // checksum is recomputed from the entries, never trusted from disk
    const { label, takenAt, entries, ...rest } = obj;
    void rest;
    if (!Array.isArray(entries)) throw new TypeError("snapshot has no entries");
    return new Snapshot(String(label), entries.map((e) => ({ path: String(e.path), size: Number(e.size) })), new Date(takenAt));
  }

  get checksum() {
    return checksumOf(this.entries);
  }
}

export const pointCodec = {
  encode: (p) => `${p.x},${p.y}`,
  decode: (s) => {
    const [x, y] = s.split(",").map(Number);
    if (Number.isNaN(x) || Number.isNaN(y)) throw new TypeError(`bad point: ${s}`);
    return { x, y };
  },
};
