import type { Frame, Header } from "../model.ts";

const MAGIC = 0x4a56;

export function encodeFrame(frame: Frame): Uint8Array {
  const payload = new TextEncoder().encode(frame.payload);
  const out = new Uint8Array(6 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, MAGIC);
  view.setUint32(2, payload.length);
  out.set(payload, 6);
  return out;
}

export function decodeFrame(bytes: Uint8Array): Frame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== MAGIC) throw new Error("bad magic");
  const length = view.getUint32(2);
  const payload = new TextDecoder().decode(bytes.subarray(6, 6 + length));
  return { payload };
}

export function parseHeader(text: string): Header {
  const [name, ...rest] = text.split(":");
  if (!name || rest.length === 0) throw new Error(`malformed header: ${text}`);
  return { name: name.trim().toLowerCase(), value: rest.join(":").trim() };
}

export function stringifyHeader(header: Header): string {
  return `${header.name}: ${header.value}`;
}
