import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import LoadingState from "./LoadingState";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE";
  department: string;
  timezone: string;
  isActive: boolean;
  reducedMonitoring: boolean;
  consentAccepted: boolean;
}

interface IssuedLink {
  email: string;
  path: string;
  token: string;
  expiresAt: string;
  delivery: { email: "not_configured" | "sent" | "failed" };
}

const ROLES = ["EMPLOYEE", "MANAGER", "SUPER_ADMIN"] as const;

function deliveryNote(delivery: IssuedLink["delivery"]) {
  if (delivery.email === "sent") return "A copy was also emailed.";
  if (delivery.email === "failed") return "Email delivery failed. Copy this link.";
  return "Email was not sent. Copy this link and give it to them directly.";
}

export default function StaffAdmin() {
  const { user: current } = useAuth();
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("EMPLOYEE");
  const [department, setDepartment] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");

  const load = useCallback(async () => {
    const res = await client.get("/admin/users");
    setUsers(res.data.users);
  }, []);

  useEffect(() => {
    void load().catch(() => setError("Could not load staff."));
  }, [load]);

  const departments = Array.from(new Set((users || []).map((row) => row.department))).sort();

  function showIssued(address: string, setup: IssuedLink) {
    setIssued({ ...setup, email: address });
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIssued(null);
    if (!name.trim() || !email.trim() || !department.trim()) {
      setError("Name, email, and department are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await client.post("/admin/users", {
        name: name.trim(),
        email: email.trim(),
        role,
        department: department.trim(),
        timezone: timezone.trim() || "America/Chicago",
      });
      setName("");
      setEmail("");
      setDepartment("");
      setRole("EMPLOYEE");
      setNotice(`Account created for ${res.data.user.email}. They still need to set a password and accept consent.`);
      showIssued(res.data.user.email, res.data.setup);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err, "Could not create the account."));
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await client.patch(`/admin/users/${editing.id}`, {
        role: editing.role,
        department: editing.department,
        timezone: editing.timezone,
        reducedMonitoring: editing.reducedMonitoring,
        isActive: editing.isActive,
      });
      setNotice(`Saved ${editing.name}.`);
      setEditing(null);
      await load();
    } catch (err: unknown) {
      setError(messageOf(err, "Could not save that account."));
    } finally {
      setSaving(false);
    }
  }

  async function issueReset(row: StaffUser) {
    setError("");
    setNotice("");
    setIssued(null);
    setLinking(true);
    try {
      const res = await client.post(`/admin/users/${row.id}/access-link`, { purpose: "RESET" });
      showIssued(row.email, res.data);
      setNotice(`Password link issued for ${row.email}.`);
    } catch (err: unknown) {
      setError(messageOf(err, "Could not issue a password link."));
    } finally {
      setLinking(false);
    }
  }

  async function copyLink() {
    if (!issued) return;
    const link = `${window.location.origin}${issued.path}#token=${encodeURIComponent(issued.token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Link copied.");
    } catch {
      setError("Could not copy automatically. Select the link and copy it.");
    }
  }

  const selfId = current
    ? String(current.id || (current as { _id?: string })._id || "")
    : "";

  return (
    <div className="card">
      <h3 className="card-title">Staff accounts</h3>
      <p className="card-intro">
        New accounts have no password until the person opens a one-time link. Email is not sent unless a live
        mailbox is configured. The link is shown once and is not written to the audit log.
      </p>

      {error && <p className="notice notice-danger">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}
      {issued && (
        <div className="notice notice-warning">
          <p className="m-0">
            One-time link for <strong>{issued.email}</strong>. {deliveryNote(issued.delivery)} Expires{" "}
            {new Date(issued.expiresAt).toLocaleString()}.
          </p>
          <p className="text-xs mt-2 mb-2">Copy it now. Reloading this page hides it.</p>
          <label htmlFor="staff-link">One-time link</label>
          <input
            id="staff-link"
            readOnly
            value={`${window.location.origin}${issued.path}#token=${encodeURIComponent(issued.token)}`}
          />
          <div className="form-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyLink()}>
              Copy link
            </button>
          </div>
        </div>
      )}

      <form onSubmit={createAccount}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="staff-name">Name</label>
            <input id="staff-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="staff-email">Email</label>
            <input
              id="staff-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="staff-role">Role</label>
            <select id="staff-role" value={role} onChange={(event) => setRole(event.target.value as StaffUser["role"])}>
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="staff-department">Department</label>
            <input
              id="staff-department"
              list="staff-departments"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              required
            />
            <datalist id="staff-departments">
              {departments.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="staff-zone">Timezone</label>
            <input id="staff-zone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" disabled={creating}>
            {creating ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>

      {users === null ? (
        <LoadingState label="Loading staff…" />
      ) : (
        <div className="table-scroll mt-4">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>{row.role}</td>
                  <td>{row.department}</td>
                  <td>
                    {row.isActive ? "Active" : "Inactive"}
                    {row.consentAccepted ? "" : " · consent pending"}
                  </td>
                  <td>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ ...row })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <form onSubmit={saveEdit} className="mt-4">
          <h4 className="card-title">Edit {editing.name}</h4>
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-role">Role</label>
              <select
                id="edit-role"
                value={editing.role}
                disabled={editing.id === selfId}
                onChange={(event) =>
                  setEditing({ ...editing, role: event.target.value as StaffUser["role"] })
                }
              >
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="edit-department">Department</label>
              <input
                id="edit-department"
                list="staff-departments"
                value={editing.department}
                onChange={(event) => setEditing({ ...editing, department: event.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-zone">Timezone</label>
              <input
                id="edit-zone"
                value={editing.timezone}
                onChange={(event) => setEditing({ ...editing, timezone: event.target.value })}
                required
              />
            </div>
          </div>
          <label className="choice">
            <input
              type="checkbox"
              checked={editing.reducedMonitoring}
              onChange={(event) => setEditing({ ...editing, reducedMonitoring: event.target.checked })}
            />
            <span>Reduced monitoring (activity and idle only)</span>
          </label>
          <label className="choice">
            <input
              type="checkbox"
              checked={editing.isActive}
              disabled={editing.id === selfId}
              onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })}
            />
            <span>
              Account active
              {editing.id === selfId ? " — you cannot deactivate your own account" : ""}
            </span>
          </label>
          <div className="form-actions">
            <button className="btn" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={linking || !editing.isActive}
              onClick={() => void issueReset(editing)}
            >
              {linking ? "Issuing…" : "Issue password link"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function messageOf(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return fallback;
}
