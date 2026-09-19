import type { Writer } from "../io.ts";
import type { Money } from "../model.ts";

export function writeString(out: Writer, value: string): void {
  const bytes = new TextEncoder().encode(value);
  writeUint32(out, bytes.length);
  out.push(bytes);
}

export function writeUint32(out: Writer, value: number): void {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  out.push(buf);
}

export function writeBool(out: Writer, value: boolean): void {
  out.push(new Uint8Array([value ? 1 : 0]));
}

export function writeDate(value: Date, out: Writer): void {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setFloat64(0, value.getTime(), true);
  out.push(buf);
}

export function writeMoney(out: Writer, value: Money): void {
  writeString(out, value.currency);
  writeUint32(out, value.cents);
}
