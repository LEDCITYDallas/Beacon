const config = require("../../config/env");

// ---------------------------------------------------------------------
// Integration adapters (Priority 6 / Section 4).
//
// LED City already runs Zoho CRM, Zoho Books, Zoho Inventory, WorkDrive and a
// website/CMS. This module reads SIGNS OF COMPLETION from those systems instead
// of relying only on manual task marking, and normalises every source into one
// signal shape:
//
//   { source, externalId, type, title, summary, evidenceUrl, occurredAt }
//
// Hard rules enforced here and in signalScanner.js:
//   - a signal can only RAISE a completion proposal; nothing closes silently
//   - only signals the relevant employee already has access to are read
//   - the evidence URL + summary are stored with the proposal, so a reviewer
//     can see exactly why the system made the suggestion
//   - with INTEGRATIONS_DRIVER=mock (the default) no vendor API is contacted
//
// Production wiring is a config step for Omair (Section 10.3-10.4): set the
// ZOHO_* / WORKDRIVE_* / CMS_* tokens and INTEGRATIONS_DRIVER=live. Nothing in
// this repo holds a live token.
// ---------------------------------------------------------------------

const HOUR = 3600 * 1000;

// Documentation of what each adapter needs before Omair enables it.
const SOURCES = {
  ZOHO_CRM: {
    label: "Zoho CRM",
    requiredScopes: ["ZohoCRM.modules.deals.READ", "ZohoCRM.modules.tasks.READ"],
    evidenceKind: "Deal / task status change",
  },
  ZOHO_BOOKS: {
    label: "Zoho Books",
    requiredScopes: ["ZohoBooks.invoices.READ", "ZohoBooks.expenses.READ"],
    evidenceKind: "Invoice / expense state change",
  },
  ZOHO_INVENTORY: {
    label: "Zoho Inventory",
    requiredScopes: ["ZohoInventory.salesorders.READ", "ZohoInventory.items.READ"],
    evidenceKind: "Sales order / shipment state change",
  },
  WORKDRIVE: {
    label: "Zoho WorkDrive",
    requiredScopes: ["WorkDrive.files.READ", "WorkDrive.folders.READ"],
    evidenceKind: "Document uploaded / shared",
  },
  WEBSITE_CMS: {
    label: "LED City website / CMS",
    requiredScopes: ["cms.content.read"],
    evidenceKind: "Page / product published",
  },
};

const DRIVER = config.integrations.driver;

function driverLabel() {
  return DRIVER === "live" ? "live" : "mock";
}

// Gated fetch: only used by the live adapters, with a hard timeout so a vendor
// outage cannot hang a scan.
async function fetchJson(url, { label = "integration", token, authScheme = "Zoho-oauthtoken", headers = {}, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `${authScheme} ${token}` } : {}),
        ...headers,
      },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        body && (body.message || body.error)
          ? String(body.message || body.error)
          : `HTTP ${res.status}`;
      const err = new Error(`${label} request failed: ${message}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Readings used by the mock driver. They are deterministic and clearly labelled
// as mock data (Section 10.2) and they correspond to the seeded mock tasks, so
// the whole detect -> propose -> human-confirm flow is demonstrable today.
function mockSignals(now = Date.now()) {
  return [
    {
      source: "ZOHO_CRM",
      externalId: "1042",
      type: "DEAL_WON",
      title: "Mock CRM deal #1042 moved to Closed Won",
      summary:
        "Mock Zoho CRM: deal #1042 (Q3 signage proposal) was marked Closed Won, so the proposal task is likely complete.",
      evidenceUrl: "https://mock.zoho.test/crm/deals/1042",
      occurredAt: new Date(now - 3 * HOUR),
    },
    {
      source: "ZOHO_BOOKS",
      externalId: "BATCH-7",
      type: "INVOICE_BATCH_RECONCILED",
      title: "Mock invoice batch BATCH-7 fully reconciled",
      summary:
        "Mock Zoho Books: every invoice in batch BATCH-7 is reconciled - the reconciliation task can be closed.",
      evidenceUrl: "https://mock.zoho.test/books/invoices/batch/BATCH-7",
      occurredAt: new Date(now - 5 * HOUR),
    },
    {
      source: "ZOHO_INVENTORY",
      externalId: "SO-2211",
      type: "SALES_ORDER_PACKED",
      title: "Mock sales order SO-2211 packed and shipped",
      summary: "Mock Zoho Inventory: sales order SO-2211 moved to Packed/Shipped.",
      evidenceUrl: "https://mock.zoho.test/inventory/salesorders/SO-2211",
      occurredAt: new Date(now - 8 * HOUR),
    },
    {
      source: "WORKDRIVE",
      externalId: "file-9a1b",
      type: "FILE_SHARED",
      title: "Mock WorkDrive document shared with the client team",
      summary:
        "Mock WorkDrive: the proposal PDF was uploaded to /Proposals and shared externally.",
      evidenceUrl: "https://mock.zoho.test/workdrive/file/9a1b",
      occurredAt: new Date(now - 2 * HOUR),
    },
    {
      source: "WEBSITE_CMS",
      externalId: "page-77",
      type: "PAGE_PUBLISHED",
      title: "Mock CMS page published: showroom display sign-out",
      summary: "Mock website CMS: the showroom display sign-out page was published live.",
      evidenceUrl: "https://mock.ledcity.test/cms/pages/77",
      occurredAt: new Date(now - 6 * HOUR),
    },
  ];
}

// --- Adapter implementations -------------------------------------------

const zohoConfigured = () =>
  Boolean(config.integrations.zoho.accessToken && config.integrations.zoho.orgId);

const ADAPTERS = {
  ZOHO_CRM: {
    key: "ZOHO_CRM",
    ...SOURCES.ZOHO_CRM,
    isConfigured: () => Boolean(config.integrations.zoho.accessToken),
    // Deals that reached a closing stage are the CRM's completion signal.
    fetchLive: async ({ since }) => {
      const json = await fetchJson(
        `${config.integrations.zoho.crmBase}/Deals?fields=Deal_Name,Stage,Modified_Time,id&per_page=50&sort_by=Modified_Time&sort_order=desc`,
        { label: "Zoho CRM", token: config.integrations.zoho.accessToken }
      );
      return (json?.data || [])
        .filter((d) => /won|closed/i.test(String(d.Stage || "")))
        .filter((d) => !since || !d.Modified_Time || new Date(d.Modified_Time) >= since)
        .map((d) => ({
          source: "ZOHO_CRM",
          externalId: String(d.id || ""),
          type: "DEAL_CLOSED",
          title: `CRM deal "${d.Deal_Name}" marked ${d.Stage}`,
          summary: `Zoho CRM: deal "${d.Deal_Name}" reached stage "${d.Stage}".`,
          evidenceUrl: `https://crm.zoho.com/crm/tab/Deals/${d.id}`,
          occurredAt: d.Modified_Time ? new Date(d.Modified_Time) : new Date(),
        }));
    },
  },

  ZOHO_BOOKS: {
    key: "ZOHO_BOOKS",
    ...SOURCES.ZOHO_BOOKS,
    isConfigured: zohoConfigured,
    // Paid/reconciled invoices are the Books completion signal.
    fetchLive: async ({ since }) => {
      const json = await fetchJson(
        `${config.integrations.zoho.booksBase}/invoices?organization_id=${config.integrations.zoho.orgId}&status=paid&per_page=50`,
        { label: "Zoho Books", token: config.integrations.zoho.accessToken }
      );
      return (json?.invoices || [])
        .filter((i) => !since || !i.last_modified_time || new Date(i.last_modified_time) >= since)
        .map((i) => ({
          source: "ZOHO_BOOKS",
          externalId: String(i.invoice_id || i.invoice_number || ""),
          type: "INVOICE_PAID",
          title: `Invoice ${i.invoice_number} paid`,
          summary: `Zoho Books: invoice ${i.invoice_number} for ${i.customer_name} is paid.`,
          evidenceUrl: `https://books.zoho.com/app#/invoices/${i.invoice_id}`,
          occurredAt: i.last_modified_time ? new Date(i.last_modified_time) : new Date(),
        }));
    },
  },

  ZOHO_INVENTORY: {
    key: "ZOHO_INVENTORY",
    ...SOURCES.ZOHO_INVENTORY,
    isConfigured: zohoConfigured,
    // Shipped sales orders are the Inventory completion signal.
    fetchLive: async ({ since }) => {
      const json = await fetchJson(
        `${config.integrations.zoho.inventoryBase}/salesorders?organization_id=${config.integrations.zoho.orgId}&per_page=50&sort_column=last_modified_time&sort_order=D`,
        { label: "Zoho Inventory", token: config.integrations.zoho.accessToken }
      );
      return (json?.salesorders || [])
        .filter((s) => /shipped|delivered|closed/i.test(String(s.status || s.shipment_status || "")))
        .filter((s) => !since || !s.last_modified_time || new Date(s.last_modified_time) >= since)
        .map((s) => ({
          source: "ZOHO_INVENTORY",
          externalId: String(s.salesorder_id || s.salesorder_number || ""),
          type: "SALES_ORDER_SHIPPED",
          title: `Sales order ${s.salesorder_number} shipped`,
          summary: `Zoho Inventory: sales order ${s.salesorder_number} (${s.customer_name}) is ${s.status || "shipped"}.`,
          evidenceUrl: `https://inventory.zoho.com/app#/salesorders/${s.salesorder_id}`,
          occurredAt: s.last_modified_time ? new Date(s.last_modified_time) : new Date(),
        }));
    },
  },
  WORKDRIVE: {
    key: "WORKDRIVE",
    ...SOURCES.WORKDRIVE,
    isConfigured: () => Boolean(config.integrations.workdrive.accessToken),
    // Recently modified / shared files are the WorkDrive completion signal.
    fetchLive: async ({ since }) => {
      const json = await fetchJson(`${config.integrations.workdrive.base}/files?limit=50`, {
        label: "WorkDrive",
        token: config.integrations.workdrive.accessToken,
      });
      return (json?.data || [])
        .map((f) => f.attributes || f)
        .filter((a) => a && a.name)
        .filter((a) => {
          const ts = a.modified_time_in_millisecond || a.modified_time;
          return !since || !ts || new Date(Number(ts) || ts) >= since;
        })
        .map((a) => ({
          source: "WORKDRIVE",
          externalId: String(a.resource_id || a.id || ""),
          type: "FILE_UPDATED",
          title: `WorkDrive file "${a.name}" updated`,
          summary: `Zoho WorkDrive: "${a.name}" was modified or shared.`,
          evidenceUrl: a.permalink || a.download_url || "https://workdrive.zoho.com",
          occurredAt: new Date(Number(a.modified_time_in_millisecond) || Date.now()),
        }));
    },
  },

  WEBSITE_CMS: {
    key: "WEBSITE_CMS",
    ...SOURCES.WEBSITE_CMS,
    isConfigured: () => Boolean(config.integrations.cms.base && config.integrations.cms.token),
    // The LED City CMS API contract is NOT confirmed yet, so the live adapter
    // reads a documented generic endpoint: GET {CMS_API_BASE}/published?since=…
    // returning { items: [{ id, title, url, publishedAt }] }. Omair confirms the
    // real shape and this mapper is adjusted once - the pipeline does not change.
    fetchLive: async ({ since }) => {
      const json = await fetchJson(
        `${config.integrations.cms.base}/published?since=${encodeURIComponent(
          (since || new Date(Date.now() - 24 * HOUR)).toISOString()
        )}`,
        {
          label: "website CMS",
          token: config.integrations.cms.token,
          authScheme: "Bearer",
        }
      );
      return (json?.items || json?.data || []).map((p) => ({
        source: "WEBSITE_CMS",
        externalId: String(p.id || p.slug || ""),
        type: "PAGE_PUBLISHED",
        title: `CMS page published: ${p.title || p.slug}`,
        summary: `LED City CMS: "${p.title || p.slug}" is published.`,
        evidenceUrl: p.url || config.integrations.cms.base,
        occurredAt: p.publishedAt ? new Date(p.publishedAt) : new Date(),
      }));
    },
  },
};

// ---------------------------------------------------------------------
// Public API used by the scanner and the admin UI.
// ---------------------------------------------------------------------

// Which sources exist, whether they are wired, and what scope they need.
function describeSources() {
  return Object.values(ADAPTERS).map((a) => ({
    key: a.key,
    label: a.label,
    driver: driverLabel(),
    configured: driverLabel() === "mock" ? true : a.isConfigured(),
    requiredScopes: a.requiredScopes,
    evidenceKind: a.evidenceKind,
  }));
}

// Read one source. Never throws for a *mock* driver; for a live driver that is
// not configured it throws INTEGRATION_NOT_CONFIGURED so the scanner can record
// a readable reason instead of a stack trace.
async function fetchSignals({ source, since, until }) {
  const adapter = ADAPTERS[source];
  if (!adapter) throw new Error(`Unknown integration source "${source}"`);

  if (driverLabel() === "mock") {
    const signals = mockSignals()
      .filter((s) => s.source === source)
      .filter((s) => !since || s.occurredAt >= since)
      .filter((s) => !until || s.occurredAt <= until);
    return { driver: "mock", signals };
  }

  if (!adapter.isConfigured()) {
    const err = new Error(
      `${adapter.label} is not configured. Omair must add the ${adapter.requiredScopes.join(", ")} OAuth token (Section 10.3-10.4).`
    );
    err.code = "INTEGRATION_NOT_CONFIGURED";
    throw err;
  }

  return { driver: "live", signals: await adapter.fetchLive({ since, until }) };
}

// Read every source. One failing source must not stop the others, so each
// result carries its own error.
async function fetchAllSignals({ since, until, sources } = {}) {
  const keys = sources && sources.length ? sources : Object.keys(ADAPTERS);
  const out = [];
  for (const key of keys) {
    try {
      const res = await fetchSignals({ source: key, since, until });
      out.push({ source: key, driver: res.driver, signals: res.signals, error: "" });
    } catch (err) {
      out.push({ source: key, driver: driverLabel(), signals: [], error: err.message, code: err.code || "" });
    }
  }
  return out;
}

module.exports = {
  SOURCES,
  ADAPTERS,
  driverLabel,
  describeSources,
  fetchSignals,
  fetchAllSignals,
  mockSignals,
};