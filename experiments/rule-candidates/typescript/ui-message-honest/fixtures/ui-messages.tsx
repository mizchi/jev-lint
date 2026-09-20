import { useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { queue } from "./queue";
import { mailer } from "./mailer";
import type { Draft, Invoice, Member } from "./types";

declare function notify(message: string, opts?: { level?: "info" | "error" }): void;
declare function showMessage(message: string): void;

export async function saveDraft(draft: Draft): Promise<void> {
  await queue.add("persist-draft", { draftId: draft.id, body: draft.body });
  toast.success("Saved");
}

export async function submitDraft(draft: Draft): Promise<void> {
  await queue.add("publish-draft", { draftId: draft.id });
  toast("Request received. We will notify you when it is published.");
}

export function resendInvoice(invoice: Invoice, email: string): void {
  mailer.send({ to: email, template: "invoice", data: { invoiceId: invoice.id } });
  toast.success(`Email sent to ${email}`);
}

export async function resendReceipt(invoice: Invoice, email: string): Promise<boolean> {
  const result = await mailer.send({ to: email, template: "receipt", data: { invoiceId: invoice.id } });
  if (!result.accepted.includes(email)) return false;
  toast.success(`Receipt emailed to ${email}`);
  return true;
}

export function CheckoutButton({ cartId, amount }: { cartId: string; amount: number }) {
  const [status, setStatus] = useState<string>("");
  const [failure, setFailure] = useState<string | null>(null);

  const onPay = () => {
    const charge = api.post("/charges", { cartId, amount });
    setStatus("Payment successful");
    charge.then((res) => {
      if (res.status !== "succeeded") setFailure(res.error);
    });
  };

  return (
    <div>
      <button onClick={onPay}>Pay {amount}</button>
      <p>{failure ?? status}</p>
    </div>
  );
}

export function SaveButton({ draft }: { draft: Draft }) {
  const [status, setStatus] = useState<string>("");
  const [done, setDone] = useState(false);

  const onSave = async () => {
    setStatus("Saving…");
    await api.put(`/drafts/${draft.id}`, draft);
    setDone(true);
  };

  return (
    <div>
      <button onClick={onSave}>Save</button>
      <span>{done ? "✓" : status}</span>
    </div>
  );
}

export function PublishButton({ draft }: { draft: Draft }) {
  const [status, setStatus] = useState<string>("");

  const onPublish = async () => {
    await api.post(`/drafts/${draft.id}/publish`);
    setStatus("Published");
  };

  return (
    <div>
      <button onClick={onPublish}>Publish</button>
      <span>{status}</span>
    </div>
  );
}

export async function importMembers(file: File, onDone: (count: number) => void): Promise<void> {
  const rows = await parseCsv(file);
  try {
    for (const row of rows) {
      if (!row.email) throw new Error(`row ${row.line}: missing email`);
      await api.post("/members", row);
    }
    onDone(rows.length);
  } catch (err) {
    toast.error("Network error, please check your connection");
  }
}

export async function removeMember(member: Member, onDone: () => void): Promise<void> {
  try {
    await api.delete(`/members/${member.id}`);
  } catch (err) {
    toast.error("Something went wrong");
    return;
  }
  onDone();
}

export async function copyShareLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    return false;
  }
  notify("Copied to clipboard");
  return true;
}

export async function startExport(projectId: string): Promise<void> {
  const job = await api.post("/exports", { projectId });
  showMessage(`Export complete. Download ready at ${job.id}`);
}

export async function inviteMember(email: string): Promise<void> {
  await api.post("/invites", { email });
  showMessage(`Invitation sent to ${email}`);
}

export async function scheduleReport(projectId: string, cron: string): Promise<void> {
  await api.post("/reports/schedules", { projectId, cron });
  notify("Report scheduled");
}

export function ProfileForm({ initial }: { initial: { name: string } }) {
  const [name, setName] = useState(initial.name);
  const [message, setMessage] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await api.put("/me", { name });
    setMessage(res.ok ? "Profile updated" : (res.error ?? "Could not update profile"));
  };

  return (
    <form onSubmit={onSubmit}>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit">Save</button>
      <p>{message}</p>
    </form>
  );
}

export function UnsubscribeLink({ listId }: { listId: string }) {
  const onClick = () => {
    api.post(`/lists/${listId}/unsubscribe`);
    alert("You have been unsubscribed");
  };
  return <a onClick={onClick}>Unsubscribe</a>;
}

export async function archiveProject(projectId: string): Promise<void> {
  await api.patch(`/projects/${projectId}`, { archived: true });
  toast.success("Project archived");
}

declare function parseCsv(file: File): Promise<Array<{ line: number; email: string; name: string }>>;
