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
  Trash2,
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
  queuedAt?: string | null;
  sentAt?: string | null;
  skippedAt?: string | null;
  updatedAt?: string | null;
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

type QueueStatus = {
  counts: Record<string, number>;
  workers: Array<{ id?: string; name?: string; addr?: string }>;
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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);

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
  const pendingRecipients = stats.pending || 0;
  const testSent = Boolean(selected?.testSentAt);
  const hasUnsavedChanges = campaignHasUnsavedChanges(selected, form);
  const canLaunch =
    Boolean(selected) &&
    !hasUnsavedChanges &&
    testSent &&
    pendingRecipients > 0 &&
    selected?.status !== "sending" &&
    selected?.status !== "completed";

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadCampaign(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const shouldPoll = selectedId && (selected?.status === "sending" || (stats.queued || 0) > 0);
    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      void loadCampaign(selectedId);
      void loadCampaigns();
    }, 10_000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.status, stats.queued]);

  async function refreshAll() {
    await Promise.all([loadCampaigns(), loadAliases(), loadSuppressions(), loadQueueStatus()]);
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
    setLastUpdatedAt(new Date());
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

  async function loadQueueStatus() {
    const data = await api("/api/queue/status");
    setQueueStatus(data);
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

  async function deleteCampaign() {
    if (!selected) return;
    const confirmed = window.confirm(
      `Delete campaign "${selected.name}"? This removes the campaign and its send log, but keeps shared recipients and suppressions.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setNotice("");
    try {
      await api(`/api/campaigns/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setSelectedId("");
      setForm(blankCampaign);
      await loadCampaigns();
      setNotice("Campaign deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete campaign.");
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
      await loadQueueStatus();
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
              <div className="readiness-list">
                <ReadinessItem ready={Boolean(selected)} label="Campaign saved" />
                <ReadinessItem ready={!hasUnsavedChanges} label={hasUnsavedChanges ? "Unsaved changes" : "Current edits saved"} />
                <ReadinessItem ready={pendingRecipients > 0} label={`${pendingRecipients} pending recipients`} />
                <ReadinessItem ready={testSent} label={testSent ? "Test email sent" : "Test email required"} />
              </div>
              {selected && (
                <div className={hasUnsavedChanges ? "sender-summary warning" : "sender-summary"}>
                  <strong>Saved sender</strong>
                  <span>{selected.fromName} &lt;{selected.fromEmailAlias}&gt;</span>
                  {hasUnsavedChanges && <em>Save campaign before testing or launching.</em>}
                </div>
              )}
              <div className="button-stack">
                <button onClick={() => setActive("recipients")} disabled={!selected || busy}>
                  <Users size={18} />
                  Add recipients
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/send-test`, "Test email sent.", { to: userEmail })}
                  disabled={!selected || hasUnsavedChanges || busy}
                  title={hasUnsavedChanges ? "Save campaign changes before sending a test." : "Send a test to your admin email"}
                >
                  <TestTube2 size={18} />
                  Send test
                </button>
                <button
                  className={canLaunch ? "send-launch" : ""}
                  onClick={() => {
                    if (!window.confirm(`Queue ${pendingRecipients} pending recipients for this campaign?`)) return;
                    void action(`/api/campaigns/${selected?.id}/launch`, "Campaign queued.");
                  }}
                  disabled={!canLaunch || busy}
                  title={
                    hasUnsavedChanges
                      ? "Save campaign changes before launching."
                      : !canLaunch
                        ? "Save the campaign, add recipients, and send a test first."
                        : "Queue pending recipients"
                  }
                >
                  <Send size={18} />
                  Launch campaign
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/pause`, "Campaign paused.")}
                  disabled={!selected || selected.status !== "sending" || busy}
                >
                  <Pause size={18} />
                  Pause
                </button>
                <button
                  onClick={() => action(`/api/campaigns/${selected?.id}/resume`, "Campaign resumed.")}
                  disabled={!selected || selected.status !== "paused" || busy}
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
                <button
                  className="danger-action"
                  onClick={deleteCampaign}
                  disabled={!selected || selected.status === "sending" || busy}
                  title={selected?.status === "sending" ? "Pause this campaign before deleting it." : "Delete campaign"}
                >
                  <Trash2 size={18} />
                  Delete campaign
                </button>
              </div>
              <p className="fine-print">{sendStatusText(selected, stats)}</p>
              <SendProgress
                campaign={selected}
                stats={stats}
                lastUpdatedAt={lastUpdatedAt}
                queueStatus={queueStatus}
              />
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
        <div className="form-field wide">
          <div className="label-row">
            <span>HTML body</span>
            <label className="file-button small-file-button">
              <FileUp size={16} />
              Upload HTML
              <input
                type="file"
                accept=".html,.htm,text/html"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setField("htmlBody", await file.text());
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <textarea value={form.htmlBody} onChange={(event) => setField("htmlBody", event.target.value)} />
        </div>
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

function campaignHasUnsavedChanges(campaign: Campaign | null, form: typeof blankCampaign) {
  if (!campaign) return false;

  return (
    campaign.name !== form.name ||
    campaign.subjectLine !== form.subjectLine ||
    campaign.fromName !== form.fromName ||
    campaign.fromEmailAlias !== form.fromEmailAlias ||
    campaign.replyToEmail !== form.replyToEmail ||
    campaign.htmlBody !== form.htmlBody ||
    campaign.textBody !== form.textBody ||
    campaign.businessIdentity !== form.businessIdentity ||
    campaign.mailingAddress !== form.mailingAddress ||
    campaign.throttlePerHour !== form.throttlePerHour ||
    campaign.errorRateStopPercent !== form.errorRateStopPercent
  );
}

function ReadinessItem({ ready, label }: { ready: boolean; label: string }) {
  return (
    <div className={ready ? "readiness-item ready" : "readiness-item"}>
      <span>{ready ? "✓" : "•"}</span>
      <strong>{label}</strong>
    </div>
  );
}

function sendStatusText(campaign: Campaign | null, stats: Record<string, number>) {
  if (!campaign) return "Save a campaign before adding recipients or sending.";
  if (campaign.status === "sending") return "This campaign is active. Queued recipients are waiting for the worker.";
  if (campaign.status === "completed") return "This campaign is complete.";
  if ((stats.queued || 0) > 0) return "Queued means the worker has not processed those recipients yet.";
  if ((stats.pending || 0) === 0) return "Add recipients before launching.";
  if (!campaign.testSentAt) return "Send a test email before launching.";
  return "Ready to launch. Pending recipients will not send until you click Launch campaign.";
}

function SendProgress({
  campaign,
  stats,
  lastUpdatedAt,
  queueStatus,
}: {
  campaign: Campaign | null;
  stats: Record<string, number>;
  lastUpdatedAt: Date | null;
  queueStatus: QueueStatus | null;
}) {
  const total = stats.total || 0;
  const hasSendActivity =
    campaign?.status === "sending" ||
    campaign?.status === "completed" ||
    (stats.queued || 0) > 0 ||
    (stats.sent || 0) > 0 ||
    (stats.failed || 0) > 0 ||
    (stats.skipped || 0) > 0 ||
    (stats.unsubscribed || 0) > 0;
  const finished =
    (stats.sent || 0) + (stats.failed || 0) + (stats.skipped || 0) + (stats.unsubscribed || 0);
  const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
  const recent = (campaign?.campaignRecipients || []).slice(-6).reverse();
  const workerCount = queueStatus?.workers.length || 0;
  const queueCounts = queueStatus?.counts || {};

  if (!campaign || total === 0 || !hasSendActivity) return null;

  return (
    <div className="send-progress">
      <div className="progress-heading">
        <strong>Send progress</strong>
        <span>{lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString()}` : "Not refreshed yet"}</span>
      </div>
      <div className="progress-track" aria-label={`${percent}% complete`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-copy">
        <strong>{percent}% complete</strong>
        <span>Auto-refreshes every 10 seconds while queued or sending.</span>
      </div>
      <div className={workerCount > 0 ? "worker-status ready" : "worker-status missing"}>
        <strong>{workerCount > 0 ? "Worker connected" : "No worker connected"}</strong>
        <span>
          waiting {queueCounts.waiting || 0}, delayed {queueCounts.delayed || 0}, active {queueCounts.active || 0}, failed{" "}
          {queueCounts.failed || 0}
        </span>
      </div>
      <div className="recipient-status-list">
        {recent.map((item) => (
          <div className="recipient-status-row" key={item.id}>
            <div>
              <strong>{item.recipient.email}</strong>
              {item.errorMessage && <span>{item.errorMessage}</span>}
              {!item.errorMessage && item.gmailMessageId && <span>{item.gmailMessageId}</span>}
            </div>
            <mark className={statusClass(item.status)}>{item.status}</mark>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusClass(status: string) {
  if (status === "sent") return "good";
  if (status === "failed") return "bad";
  if (status === "queued") return "queued";
  return "";
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
