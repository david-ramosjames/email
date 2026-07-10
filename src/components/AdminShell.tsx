"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import Papa from "papaparse";
import {
  AtSign,
  Ban,
  CheckCircle2,
  Copy,
  FileUp,
  Inbox,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  Send,
  Settings,
  TestTube2,
  Users,
} from "lucide-react";
import { personalize, validateEmail } from "@/lib/email";

type Alias = {
  id: string;
  email: string;
  displayName: string | null;
  replyTo: string | null;
  isDefault: boolean;
  isVerified: boolean;
};

type Recipient = {
  id?: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  firm_name?: string | null;
  city?: string | null;
  practice_area?: string | null;
  notes?: string | null;
};

type CampaignRecipient = {
  id: string;
  status: string;
  gmailMessageId?: string | null;
  errorMessage?: string | null;
  recipient: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    firmName?: string | null;
    city?: string | null;
    practiceArea?: string | null;
    notes?: string | null;
  };
};

type Campaign = {
  id: string;
  name: string;
  subjectLine: string;
  fromName: string;
  fromEmailAlias: string;
  replyToEmail: string;
  htmlBody: string;
  textBody: string;
  businessIdentity: string;
  mailingAddress: string;
  throttlePerHour: number;
  errorRateStopPercent: number;
  status: string;
  testSentAt?: string | null;
  campaignRecipients?: CampaignRecipient[];
  stats?: Record<string, number>;
};

type Suppression = {
  id: string;
  email: string;
  reason?: string | null;
  source: string;
  createdAt: string;
};

const blankCampaign = {
  name: "",
  subjectLine: "Referral introduction for {{firm_name}}",
  fromName: "",
  fromEmailAlias: "",
  replyToEmail: "",
  htmlBody:
    "<p>Hi {{first_name}},</p><p>I wanted to reach out about referral opportunities in {{practice_area}} around {{city}}.</p><p>Best,<br />{{sender_name}}</p>",
  textBody:
    "Hi {{first_name}},\n\nI wanted to reach out about referral opportunities in {{practice_area}} around {{city}}.\n\nBest,\n{{sender_name}}",
  businessIdentity: process.env.NEXT_PUBLIC_DEFAULT_BUSINESS_IDENTITY || "",
  mailingAddress: process.env.NEXT_PUBLIC_DEFAULT_MAILING_ADDRESS || "",
  throttlePerHour: 25,
  errorRateStopPercent: 20,
};

const navItems = [
  { id: "campaigns", label: "Campaigns", icon: Inbox },
  { id: "recipients", label: "Recipients", icon: Users },
  { id: "suppression", label: "Suppression List", icon: Ban },
  { id: "aliases", label: "Aliases", icon: AtSign },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AdminShell({ userEmail }: { userEmail?: string | null }) {
  const [active, setActive] = useState("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [form, setForm] = useState(blankCampaign);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [rawRecipients, setRawRecipients] = useState("");
  const [validRows, setValidRows] = useState<Recipient[]>([]);
  const [invalidRows, setInvalidRows] = useState<Array<{ row: number; email: string; reason: string }>>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [suppressionEmail, setSuppressionEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedRecipient = selected?.campaignRecipients?.[previewIndex];
  const previewFields = selectedRecipient
    ? toTemplateFields(selectedRecipient)
    : validRows[previewIndex] || {
        email: "sample@example.com",
        first_name: "Jordan",
        firm_name: "North Shore Law",
        city: "Chicago",
        practice_area: "Family Law",
      };

  const stats = useMemo(() => {
    const rows = selected?.campaignRecipients || [];
    return rows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      { total: 0 } as Record<string, number>,
    );
  }, [selected]);

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadCampaign(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function refreshAll() {
    await Promise.all([loadCampaigns(), loadAliases(), loadSuppressions()]);
  }

  async function api(path: string, options?: RequestInit) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      ...options,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  async function loadCampaigns() {
    const data = await api("/api/campaigns");
    setCampaigns(data.campaigns);
    setSelectedId((current) => current || data.campaigns[0]?.id || "");
  }

  async function loadCampaign(id: string) {
    const data = await api(`/api/campaigns/${id}`);
    setSelected(data.campaign);
    setForm({
      name: data.campaign.name,
      subjectLine: data.campaign.subjectLine,
      fromName: data.campaign.fromName,
      fromEmailAlias: data.campaign.fromEmailAlias,
      replyToEmail: data.campaign.replyToEmail,
      htmlBody: data.campaign.htmlBody,
      textBody: data.campaign.textBody,
      businessIdentity: data.campaign.businessIdentity,
      mailingAddress: data.campaign.mailingAddress,
      throttlePerHour: data.campaign.throttlePerHour,
      errorRateStopPercent: data.campaign.errorRateStopPercent,
    });
  }

  async function loadAliases() {
    const data = await api("/api/aliases");
    setAliases(data.aliases);
  }

  async function loadSuppressions() {
    const data = await api("/api/suppression-list");
    setSuppressions(data.suppressions);
  }

  function setField(key: keyof typeof form, value: string | number) {
    setForm((current) => {
      if (key === "fromEmailAlias" && typeof value === "string" && !current.replyToEmail) {
        return { ...current, fromEmailAlias: value, replyToEmail: value };
      }

      return { ...current, [key]: value };
    });
  }

  async function saveCampaign() {
    setBusy(true);
    setNotice("");
    try {
      const path = selected ? `/api/campaigns/${selected.id}` : "/api/campaigns";
      const method = selected ? "PATCH" : "POST";
      const data = await api(path, { method, body: JSON.stringify(form) });
      setSelectedId(data.campaign.id);
      await loadCampaigns();
      await loadCampaign(data.campaign.id);
      setNotice("Campaign saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save campaign.");
    } finally {
      setBusy(false);
    }
  }

  function parseRecipients(input: string) {
    const result = Papa.parse<Record<string, string>>(input, {
      header: input.includes(","),
      skipEmptyLines: true,
    });
    const rows = result.data.map((row) => normalizeRecipientRow(row));
    const seen = new Set<string>();
    const valid: Recipient[] = [];
    const invalid: Array<{ row: number; email: string; reason: string }> = [];

    rows.forEach((row, index) => {
      const email = row.email?.trim() || "";
      const normalized = email.toLowerCase();
      if (!email || !validateEmail(email)) {
        invalid.push({ row: index + 1, email, reason: "Invalid email" });
      } else if (seen.has(normalized)) {
        invalid.push({ row: index + 1, email, reason: "Duplicate in import" });
      } else {
        seen.add(normalized);
        valid.push(row);
      }
    });

    setValidRows(valid);
    setInvalidRows(invalid);
    setPreviewIndex(0);
  }

  async function importRecipients() {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      const data = await api(`/api/campaigns/${selected.id}/recipients`, {
        method: "POST",
        body: JSON.stringify({ recipients: validRows }),
      });
      await loadCampaign(selected.id);
      await loadCampaigns();
      setNotice(`Imported ${data.imported}; skipped ${data.skipped}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not import recipients.");
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, success: string, body?: object) {
    if (!selected) return;
    setBusy(true);
    setNotice("");
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await loadCampaign(selected.id);
      await loadCampaigns();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addSuppression() {
    setBusy(true);
    setNotice("");
    try {
      await api("/api/suppression-list", {
        method: "POST",
        body: JSON.stringify({ email: suppressionEmail, reason: "Manual suppression" }),
      });
      setSuppressionEmail("");
      await loadSuppressions();
      if (selected) await loadCampaign(selected.id);
      setNotice("Suppression added.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add suppression.");
    } finally {
      setBusy(false);
    }
  }

  async function syncAliases() {
    setBusy(true);
    setNotice("");
    try {
      const data = await api("/api/aliases/sync", { method: "POST" });
      setAliases(data.aliases);
      setNotice("Aliases synced from Gmail.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not sync aliases.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ListChecks size={24} />
          <div>
            <strong>Referral Merge</strong>
            <span>Internal outreach</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={active === item.id ? "active" : ""}
                onClick={() => setActive(item.id)}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="account">
          <span>{userEmail}</span>
          <button onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Verified-alias Gmail sending</p>
            <h1>{sectionTitle(active)}</h1>
          </div>
          <div className="toolbar">
            <button className="icon-button" onClick={refreshAll} title="Refresh">
              <RefreshCw size={18} />
            </button>
            <button className="primary-action" onClick={saveCampaign} disabled={busy}>
              <CheckCircle2 size={18} />
              Save campaign
            </button>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}

        {active === "campaigns" && (
          <section className="campaign-grid">
            <div className="panel list-panel">
              <div className="panel-heading">
                <h2>Campaigns</h2>
                <button
                  onClick={() => {
                    setSelected(null);
                    setSelectedId("");
                    setForm(blankCampaign);
                  }}
                >
                  New
                </button>
              </div>
              <div className="campaign-list">
                {campaigns.map((campaign) => (
                  <button
                    key={campaign.id}
                    className={selectedId === campaign.id ? "campaign-row selected" : "campaign-row"}
                    onClick={() => setSelectedId(campaign.id)}
                  >
                    <strong>{campaign.name}</strong>
                    <span>{campaign.status}</span>
                    <small>{campaign.stats?.sent || 0} sent / {campaign.stats?.total || 0} total</small>
                  </button>
                ))}
              </div>
            </div>

            <CampaignEditor form={form} aliases={aliases} setField={setField} />

            <div className="panel action-panel">
              <h2>Send controls</h2>
              <Stats stats={stats} />
              <div className="button-stack">
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/send-test`, "Test email sent.", { to: userEmail })}
                  disabled={!selected || busy}
                >
                  <TestTube2 size={18} />
                  Send test
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/launch`, "Campaign queued.")}
                  disabled={!selected || busy}
                >
                  <Send size={18} />
                  Launch queue
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/pause`, "Campaign paused.")}
                  disabled={!selected || busy}
                >
                  <Pause size={18} />
                  Pause
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/resume`, "Campaign resumed.")}
                  disabled={!selected || busy}
                >
                  <Play size={18} />
                  Resume
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/duplicate`, "Campaign duplicated.")}
                  disabled={!selected || busy}
                >
                  <Copy size={18} />
                  Duplicate
                </button>
              </div>
              <p className="fine-print">
                Launch requires a test email. Sent recipients are never queued again inside the same campaign.
              </p>
            </div>
          </section>
        )}

        {active === "recipients" && (
          <section className="two-column">
            <div className="panel">
              <h2>Paste or upload recipients</h2>
              <textarea
                className="recipient-input"
                value={rawRecipients}
                onChange={(event) => {
                  setRawRecipients(event.target.value);
                  parseRecipients(event.target.value);
                }}
                placeholder="email,first_name,last_name,firm_name,city,practice_area,notes"
              />
              <div className="toolbar wrap">
                <label className="file-button">
                  <FileUp size={18} />
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      setRawRecipients(text);
                      parseRecipients(text);
                    }}
                  />
                </label>
                <button onClick={importRecipients} disabled={!selected || validRows.length === 0 || busy}>
                  Import {validRows.length}
                </button>
              </div>
              <ImportReview validRows={validRows} invalidRows={invalidRows} />
            </div>
            <PreviewPanel
              subject={form.subjectLine}
              html={form.htmlBody}
              text={form.textBody}
              fields={previewFields}
              recipients={selected?.campaignRecipients || []}
              previewIndex={previewIndex}
              setPreviewIndex={setPreviewIndex}
            />
          </section>
        )}

        {active === "suppression" && (
          <section className="two-column">
            <div className="panel">
              <h2>Add suppression</h2>
              <div className="inline-form">
                <input
                  type="email"
                  value={suppressionEmail}
                  onChange={(event) => setSuppressionEmail(event.target.value)}
                  placeholder="name@example.com"
                />
                <button onClick={addSuppression} disabled={busy || !suppressionEmail}>
                  Add
                </button>
              </div>
            </div>
            <div className="panel">
              <h2>Do-not-contact list</h2>
              <div className="data-table">
                {suppressions.map((item) => (
                  <div className="data-row" key={item.id}>
                    <strong>{item.email}</strong>
                    <span>{item.reason || item.source}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {active === "aliases" && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Google Workspace aliases</h2>
              <button onClick={syncAliases} disabled={busy}>
                <RefreshCw size={18} />
                Sync from Gmail
              </button>
            </div>
            <div className="alias-grid">
              {aliases.map((alias) => (
                <article className="alias-card" key={alias.id}>
                  <strong>{alias.email}</strong>
                  <span>{alias.displayName || "No display name"}</span>
                  <mark className={alias.isVerified ? "good" : "bad"}>
                    {alias.isVerified ? "Verified" : "Unverified"}
                  </mark>
                </article>
              ))}
            </div>
          </section>
        )}

        {active === "settings" && (
          <section className="panel settings-panel">
            <h2>Sending safeguards</h2>
            <div className="settings-list">
              <div>
                <strong>Approved admins</strong>
                <span>Controlled by APPROVED_ADMIN_EMAILS.</span>
              </div>
              <div>
                <strong>Token storage</strong>
                <span>OAuth tokens are encrypted with TOKEN_ENCRYPTION_KEY before database storage.</span>
              </div>
              <div>
                <strong>Queue</strong>
                <span>BullMQ uses REDIS_URL; the worker sends one job at a time with per-campaign delays.</span>
              </div>
              <div>
                <strong>Tracking</strong>
                <span>Send, failure, skipped, test, unsubscribe, and queue events are logged. Opens/clicks are not enabled.</span>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CampaignEditor({
  form,
  aliases,
  setField,
}: {
  form: typeof blankCampaign;
  aliases: Alias[];
  setField: (key: keyof typeof blankCampaign, value: string | number) => void;
}) {
  return (
    <div className="panel editor-panel">
      <h2>Campaign editor</h2>
      <div className="form-grid">
        <label>
          Campaign name
          <input value={form.name} onChange={(event) => setField("name", event.target.value)} />
        </label>
        <label>
          Subject line
          <input value={form.subjectLine} onChange={(event) => setField("subjectLine", event.target.value)} />
        </label>
        <label>
          From name
          <input value={form.fromName} onChange={(event) => setField("fromName", event.target.value)} />
        </label>
        <label>
          From alias
          <select value={form.fromEmailAlias} onChange={(event) => setField("fromEmailAlias", event.target.value)}>
            <option value="">Select verified alias</option>
            {aliases.map((alias) => (
              <option key={alias.id} value={alias.email} disabled={!alias.isVerified}>
                {alias.email}{alias.isVerified ? "" : " (unverified)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reply-to
          <input value={form.replyToEmail} onChange={(event) => setField("replyToEmail", event.target.value)} />
        </label>
        <label>
          Hourly limit
          <input
            type="number"
            min={1}
            max={50}
            value={form.throttlePerHour}
            onChange={(event) => setField("throttlePerHour", Number(event.target.value))}
          />
        </label>
        <label className="wide">
          HTML body
          <textarea value={form.htmlBody} onChange={(event) => setField("htmlBody", event.target.value)} />
        </label>
        <label className="wide">
          Plain text fallback
          <textarea value={form.textBody} onChange={(event) => setField("textBody", event.target.value)} />
        </label>
        <label>
          Business identity
          <input value={form.businessIdentity} onChange={(event) => setField("businessIdentity", event.target.value)} />
        </label>
        <label>
          Error stop %
          <input
            type="number"
            min={1}
            max={100}
            value={form.errorRateStopPercent}
            onChange={(event) => setField("errorRateStopPercent", Number(event.target.value))}
          />
        </label>
        <label className="wide">
          Mailing address
          <textarea value={form.mailingAddress} onChange={(event) => setField("mailingAddress", event.target.value)} />
        </label>
      </div>
    </div>
  );
}

function Stats({ stats }: { stats: Record<string, number> }) {
  const entries = ["total", "pending", "queued", "sent", "failed", "skipped", "unsubscribed"];
  return (
    <div className="stats-grid">
      {entries.map((entry) => (
        <div key={entry}>
          <strong>{stats[entry] || 0}</strong>
          <span>{entry}</span>
        </div>
      ))}
    </div>
  );
}

function ImportReview({
  validRows,
  invalidRows,
}: {
  validRows: Recipient[];
  invalidRows: Array<{ row: number; email: string; reason: string }>;
}) {
  return (
    <div className="review-grid">
      <div>
        <h3>Valid rows</h3>
        <div className="data-table compact">
          {validRows.slice(0, 8).map((row) => (
            <div className="data-row" key={row.email}>
              <strong>{row.email}</strong>
              <span>{row.firm_name || row.city || "Ready"}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3>Invalid rows</h3>
        <div className="data-table compact">
          {invalidRows.slice(0, 8).map((row) => (
            <div className="data-row invalid" key={`${row.row}-${row.email}`}>
              <strong>Row {row.row}</strong>
              <span>{row.reason}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  subject,
  html,
  text,
  fields,
  recipients,
  previewIndex,
  setPreviewIndex,
}: {
  subject: string;
  html: string;
  text: string;
  fields: Recipient;
  recipients: CampaignRecipient[];
  previewIndex: number;
  setPreviewIndex: (index: number) => void;
}) {
  return (
    <div className="panel preview-panel">
      <div className="panel-heading">
        <h2>Personalized preview</h2>
        {recipients.length > 0 && (
          <select value={previewIndex} onChange={(event) => setPreviewIndex(Number(event.target.value))}>
            {recipients.map((item, index) => (
              <option key={item.id} value={index}>
                {item.recipient.email}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="email-preview">
        <strong>{personalize(subject, fields)}</strong>
        <div dangerouslySetInnerHTML={{ __html: personalize(html, fields) }} />
      </div>
      <pre>{personalize(text, fields)}</pre>
    </div>
  );
}

function normalizeRecipientRow(row: Record<string, string>): Recipient {
  const values = Object.values(row);
  if (!("email" in row) && values.length > 0) {
    return { email: values[0] || "" };
  }

  return {
    email: row.email || "",
    first_name: row.first_name || row.firstName || "",
    last_name: row.last_name || row.lastName || "",
    firm_name: row.firm_name || row.firmName || "",
    city: row.city || "",
    practice_area: row.practice_area || row.practiceArea || "",
    notes: row.notes || "",
  };
}

function toTemplateFields(item: CampaignRecipient): Recipient {
  return {
    email: item.recipient.email,
    first_name: item.recipient.firstName,
    last_name: item.recipient.lastName,
    firm_name: item.recipient.firmName,
    city: item.recipient.city,
    practice_area: item.recipient.practiceArea,
    notes: item.recipient.notes,
  };
}

function sectionTitle(active: string) {
  return navItems.find((item) => item.id === active)?.label || "Dashboard";
}
