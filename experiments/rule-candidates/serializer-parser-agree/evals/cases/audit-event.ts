export interface AuditEvent {
  id: string;
  action: string;
  target: string;
  occurredAt: Date;
  metadata: Record<string, string>;
}

export function marshalEvent(event: AuditEvent): Buffer {
  const wire = {
    id: event.id,
    action: event.action,
    target: event.target,
    occurredAt: event.occurredAt.toISOString(),
    metadata: event.metadata,
  };
  return Buffer.from(JSON.stringify(wire), "utf8");
}

export function unmarshalEvent(buf: Buffer): AuditEvent {
  const wire = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  if (typeof wire.actor !== "string") {
    throw new Error("audit event is missing its actor");
  }
  return {
    id: String(wire.id),
    action: String(wire.action),
    target: String(wire.target),
    occurredAt: new Date(String(wire.occurredAt)),
    metadata: (wire.metadata as Record<string, string>) ?? {},
  };
}

export function serializeHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k.toLowerCase()}: ${v}`)
    .join("\r\n");
}

export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return out;
}
