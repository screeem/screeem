"use client";

import { useEffect, useState } from "react";

type FormView = { id: string; name: string; endpoint_key: string; allowed_origin: string | null; success_url: string | null; is_active: boolean; created_at: string };
type Submission = { id: string; payload: Record<string, unknown>; origin: string | null; created_at: string };

export function Forms({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const [forms, setForms] = useState<FormView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [name, setName] = useState("");
  const [allowedOrigin, setAllowedOrigin] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadForms() {
    const response = await fetch(`/api/teams/${teamId}/forms`);
    if (!response.ok) return setError("Could not load forms");
    const body = await response.json();
    setForms(body.forms);
  }

  useEffect(() => { void loadForms(); }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createForm(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch(`/api/teams/${teamId}/forms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, allowedOrigin, successUrl }) });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Could not create form");
    else { setForms((current) => [body.form, ...current]); setName(""); setAllowedOrigin(""); setSuccessUrl(""); }
    setBusy(false);
  }

  async function loadSubmissions(formId: string) {
    setSelected(formId); setError("");
    const response = await fetch(`/api/teams/${teamId}/forms/${formId}/submissions`);
    if (!response.ok) return setError("Could not load submissions");
    setSubmissions((await response.json()).submissions);
  }

  async function toggle(form: FormView) {
    const response = await fetch(`/api/teams/${teamId}/forms/${form.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !form.is_active }) });
    if (response.ok) setForms((items) => items.map((item) => item.id === form.id ? { ...item, is_active: !item.is_active } : item));
    else setError("Could not update form");
  }

  async function remove(form: FormView) {
    if (!window.confirm(`Delete ${form.name} and all of its submissions?`)) return;
    const response = await fetch(`/api/teams/${teamId}/forms/${form.id}`, { method: "DELETE" });
    if (!response.ok) return setError("Could not delete form");
    setForms((items) => items.filter((item) => item.id !== form.id));
    if (selected === form.id) { setSelected(null); setSubmissions([]); }
  }

  const endpoint = (key: string) => `${typeof window === "undefined" ? "" : window.location.origin}/api/forms/${key}/submissions`;

  return <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
    <h2 className="text-lg font-semibold text-gray-900">Forms</h2>
    <p className="mt-1 text-sm text-gray-500">Collect submissions from any website into this team workspace.</p>

    {canManage && <form onSubmit={createForm} className="mt-5 grid gap-3 md:grid-cols-3">
      <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Contact form" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <input type="url" value={allowedOrigin} onChange={(event) => setAllowedOrigin(event.target.value)} placeholder="Allowed origin (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <input type="url" value={successUrl} onChange={(event) => setSuccessUrl(event.target.value)} placeholder="Success redirect (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <button disabled={busy} className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Create form</button>
    </form>}
    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

    <div className="mt-6 space-y-3">
      {forms.length === 0 && <p className="text-sm text-gray-500">No forms yet.</p>}
      {forms.map((form) => <div key={form.id} className="rounded-md border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><span className="font-medium text-gray-900">{form.name}</span><span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${form.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{form.is_active ? "Active" : "Paused"}</span></div>
          <div className="flex gap-2 text-sm">
            <button onClick={() => loadSubmissions(form.id)} className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50">Submissions</button>
            {canManage && <button onClick={() => toggle(form)} className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50">{form.is_active ? "Pause" : "Resume"}</button>}
            {canManage && <button onClick={() => remove(form)} className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50">Delete</button>}
          </div>
        </div>
        <div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-3 py-2 text-xs">{endpoint(form.endpoint_key)}</code><button onClick={() => navigator.clipboard.writeText(endpoint(form.endpoint_key))} className="rounded border border-gray-200 px-3 text-xs">Copy</button></div>
        <pre className="mt-2 overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{`<form action="${endpoint(form.endpoint_key)}" method="POST">\n  <input name="email" type="email" required>\n  <input name="_gotcha" style="display:none">\n  <button type="submit">Send</button>\n</form>`}</pre>
        {form.allowed_origin && <p className="mt-2 text-xs text-gray-500">Accepting requests from {form.allowed_origin}</p>}
      </div>)}
    </div>

    {selected && <div className="mt-6 border-t border-gray-100 pt-5">
      <h3 className="font-medium text-gray-900">Recent submissions</h3>
      <div className="mt-3 space-y-2">{submissions.length === 0 ? <p className="text-sm text-gray-500">No submissions yet.</p> : submissions.map((submission) => <details key={submission.id} className="rounded border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm text-gray-700">{new Date(submission.created_at).toLocaleString()} {submission.origin ? `· ${submission.origin}` : ""}</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-3 text-xs">{JSON.stringify(submission.payload, null, 2)}</pre>
      </details>)}</div>
    </div>}
  </section>;
}
