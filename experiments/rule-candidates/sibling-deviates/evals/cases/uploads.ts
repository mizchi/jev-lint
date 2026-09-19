import type { Bucket } from "../storage.ts";

export async function putAvatar(bucket: Bucket, userId: string, body: Uint8Array): Promise<void> {
  await bucket.put(`avatars/${userId}`, body, { contentType: "image/png" });
}

export async function putAttachment(bucket: Bucket, key: string, body: Uint8Array): Promise<void> {
  await bucket.put(`attachments/${key}`, body);
}

export async function putExport(bucket: Bucket, key: string, body: Uint8Array, opts?: { ttlSeconds?: number }): Promise<void> {
  await bucket.put(`exports/${key}`, body, { expiresIn: opts?.ttlSeconds ?? 86400 });
}

export async function putThumbnail(bucket: Bucket, key: string, body: Uint8Array): Promise<void> {
  await bucket.put(`thumbnails/${key}`, body, { contentType: "image/webp" });
}

export async function putBackup(bucket: Bucket, key: string, body: Uint8Array): Promise<void> {
  await bucket.put(`backups/${key}`, body);
}
