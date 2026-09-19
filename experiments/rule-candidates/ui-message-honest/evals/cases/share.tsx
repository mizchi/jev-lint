import { useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { queue } from "./queue";
import type { Comment, Doc } from "./types";

export function DocTitleForm({ doc }: { doc: Doc }) {
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Saving…");
    await api.patch(`/docs/${doc.id}`, { title });
    setStatus("Saved");
  };

  return (
    <form onSubmit={onSubmit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit">Save</button>
      <span>{status}</span>
    </form>
  );
}

export function ShareButton({ doc, teamId }: { doc: Doc; teamId: string }) {
  const onShare = () => {
    const req = api.post(`/docs/${doc.id}/share`, { teamId });
    toast.success("Shared with your team");
    req.catch(() => toast.error("Sharing failed"));
  };
  return <button onClick={onShare}>Share</button>;
}

export async function sendInvoice(invoiceId: string, email: string): Promise<void> {
  try {
    await api.post(`/invoices/${invoiceId}/send`, { email });
    toast.success(`Invoice sent to ${email}`);
  } catch {
    toast.error("Could not send the invoice");
  }
}

export async function deleteComment(comment: Comment): Promise<void> {
  await api.patch(`/comments/${comment.id}`, { hidden: true });
  toast.success("Comment deleted");
}

export async function hideComment(comment: Comment): Promise<void> {
  await api.patch(`/comments/${comment.id}`, { hidden: true });
  toast.success("Comment hidden");
}

export function ExportPanel({ doc }: { doc: Doc }) {
  const [status, setStatus] = useState<string>("");

  const onExport = async () => {
    setStatus("Exporting…");
    await queue.add("export-doc", { docId: doc.id, format: "pdf" });
    setStatus("Export finished");
  };

  return (
    <div>
      <button onClick={onExport}>Export as PDF</button>
      <span>{status}</span>
    </div>
  );
}

export function DraftOutbox({ doc }: { doc: Doc }) {
  const [notice, setNotice] = useState<string>("");

  const onSave = () => {
    queue.add("persist-doc", { docId: doc.id, body: doc.body });
    setNotice("Saved");
  };

  return (
    <div>
      <button onClick={onSave}>Save</button>
      <p>{notice}</p>
    </div>
  );
}

export async function requestReview(doc: Doc, reviewerId: string): Promise<void> {
  await api.post(`/docs/${doc.id}/reviews`, { reviewerId });
  toast("Review requested. The reviewer will be notified.");
}

export async function restoreVersion(doc: Doc, versionId: string): Promise<boolean> {
  try {
    await api.post(`/docs/${doc.id}/restore`, { versionId });
  } catch (err) {
    toast.error("Something went wrong while restoring");
    return false;
  }
  toast.success("Version restored");
  return true;
}

export function RenameDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const [name, setName] = useState(doc.title);
  const [banner, setBanner] = useState<string>("");

  const onRename = () => {
    void api.patch(`/docs/${doc.id}`, { title: name });
    setBanner("Renamed");
    onClose();
  };

  return (
    <dialog open>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={onRename}>Rename</button>
      <p>{banner}</p>
    </dialog>
  );
}
