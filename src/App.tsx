import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Car,
  Search,
  Plus,
  Trash2,
  Upload,
  Download,
  Users,
  CalendarClock,
  Phone,  ShieldCheck,
  Cloud,
  Wifi,
  WifiOff,
  KeyRound,
  LogOut,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const LOCAL_STORAGE_KEY = "ffi-courtesy-car-db-v2";
const SUPABASE_SETTINGS_KEY = "ffi-courtesy-car-supabase-settings";
const SESSION_KEY = "ffi-courtesy-car-staff-session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const VEHICLE_OPTIONS = ["Tahoe 1", "Tahoe 2", "Fusion"] as const;

type Attachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type CheckoutRecord = {
  id: string;
  customerName: string;
  contactPhone: string;
  email: string;
  vehicle: string;
  aircraftNNumber: string;
  checkoutInitials: string;
  checkinInitials: string;
  checkoutAt: string;
  expectedReturnAt: string;
  actualReturnAt: string;
  destination: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  driverLicenseCopy: Attachment | null;
  useAgreement: Attachment | null;
  lastEditedBy: string;
};

type CustomerProfile = {
  id: string;
  customerName: string;
  contactPhone: string;
  email: string;
  driverLicenseCopy: Attachment | null;
  useAgreement: Attachment | null;
  updatedAt: string;
};

type SupabaseSettings = {
  url: string;
  anonKey: string;
  staffPasscode: string;
};

type StaffSession = {
  name: string;
  initials: string;
  signedInAt: string;
};

type CloudState = "local" | "connecting" | "connected" | "error";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayInputValue() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function sanitizeInitials(value: string) {
  return value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
}

function emptyForm(initials = ""): CheckoutRecord {
  return {
    id: "",
    customerName: "",
    contactPhone: "",
    email: "",
    vehicle: "Tahoe 1",
    aircraftNNumber: "",
    checkoutInitials: initials,
    checkinInitials: "",
    checkoutAt: todayInputValue(),
    expectedReturnAt: "",
    actualReturnAt: "",
    destination: "",
    notes: "",
    createdAt: "",
    updatedAt: "",
    driverLicenseCopy: null,
    useAgreement: null,
    lastEditedBy: "",
  };
}

function normalizeRecord(raw: Partial<CheckoutRecord>): CheckoutRecord {
  return {
    ...emptyForm(),
    ...raw,
    id: raw.id || uid(),
    vehicle: VEHICLE_OPTIONS.includes((raw.vehicle as (typeof VEHICLE_OPTIONS)[number]) || "Tahoe 1")
      ? (raw.vehicle as string)
      : "Tahoe 1",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    checkoutInitials: sanitizeInitials(raw.checkoutInitials || ""),
    checkinInitials: sanitizeInitials(raw.checkinInitials || ""),
    aircraftNNumber: (raw.aircraftNNumber || "").toUpperCase(),
    lastEditedBy: raw.lastEditedBy || "",
  };
}

function normalizeCustomer(raw: Partial<CustomerProfile>): CustomerProfile {
  return {
    id: raw.id || uid(),
    customerName: raw.customerName || "",
    contactPhone: raw.contactPhone || "",
    email: raw.email || "",
    driverLicenseCopy: raw.driverLicenseCopy || null,
    useAgreement: raw.useAgreement || null,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function getSavedSupabaseSettings(): SupabaseSettings {
  const envUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL || "";
  const envAnonKey = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_ANON_KEY || "";
  const envStaffPasscode = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_STAFF_PASSCODE || "";

  try {
    const raw = localStorage.getItem(SUPABASE_SETTINGS_KEY);
    const localSettings = raw ? (JSON.parse(raw) as Partial<SupabaseSettings>) : {};

    return {
      url: envUrl || localSettings.url || "",
      anonKey: envAnonKey || localSettings.anonKey || "",
      staffPasscode: envStaffPasscode || localSettings.staffPasscode || "",
    };
  } catch {
    return {
      url: envUrl,
      anonKey: envAnonKey,
      staffPasscode: envStaffPasscode,
    };
  }
}

function getSavedSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StaffSession;
    if (!parsed.name || !parsed.initials) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getLocalRecords(): CheckoutRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const cutoff = Date.now() - ONE_YEAR_MS;
    return (JSON.parse(raw) as Partial<CheckoutRecord>[])
      .map(normalizeRecord)
      .filter((r) => new Date(r.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

function setLocalRecords(records: CheckoutRecord[]) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
}

function buildCustomerProfiles(records: CheckoutRecord[]): CustomerProfile[] {
  const map = new Map<string, CustomerProfile>();

  records.forEach((record) => {
    const key = [record.customerName.trim().toLowerCase(), record.contactPhone.trim(), record.email.trim().toLowerCase()]
      .filter(Boolean)
      .join("|");

    if (!key) return;

    const existing = map.get(key);
    const candidate = normalizeCustomer({
      id: existing?.id || uid(),
      customerName: record.customerName,
      contactPhone: record.contactPhone,
      email: record.email,
      driverLicenseCopy: record.driverLicenseCopy,
      useAgreement: record.useAgreement,
      updatedAt: record.updatedAt || new Date().toISOString(),
    });

    if (!existing || new Date(candidate.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      map.set(key, candidate);
    }
  });

  return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName));
}

async function fileToDataUrl(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: String(reader.result || ""),
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function createSupabase(settings: SupabaseSettings): SupabaseClient | null {
  if (!settings.url || !settings.anonKey) return null;
  try {
    return createClient(settings.url, settings.anonKey, {
      auth: { persistSession: false },
    });
  } catch {
    return null;
  }
}

async function ensureSupabaseSchema(client: SupabaseClient) {
  const { error: recordsError } = await client.from("courtesy_car_records").select("id", { count: "exact", head: true });
  const { error: customersError } = await client.from("courtesy_car_customers").select("id", { count: "exact", head: true });

  return {
    ok: !recordsError && !customersError,
    message:
      !recordsError && !customersError
        ? "Connected"
        : "Supabase is reachable, but the required tables do not exist yet.",
  };
}

async function fetchCloudData(client: SupabaseClient) {
  const [recordsRes, customersRes] = await Promise.all([
    client.from("courtesy_car_records").select("*").order("createdAt", { ascending: false }),
    client.from("courtesy_car_customers").select("*").order("customerName", { ascending: true }),
  ]);

  if (recordsRes.error) throw new Error(recordsRes.error.message);
  if (customersRes.error) throw new Error(customersRes.error.message);

  return {
    records: (recordsRes.data || []).map(normalizeRecord),
    customers: (customersRes.data || []).map(normalizeCustomer),
  };
}

export default function CourtesyCarDatabaseApp() {
  const [records, setRecords] = useState<CheckoutRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CheckoutRecord>(emptyForm());
  const [settings, setSettings] = useState<SupabaseSettings>(getSavedSupabaseSettings());
  const [session, setSession] = useState<StaffSession | null>(getSavedSession());
  const [cloudState, setCloudState] = useState<CloudState>("local");
  const [cloudMessage, setCloudMessage] = useState("Using local demo mode.");
  const [showSetup, setShowSetup] = useState(false);
  const [setupForm, setSetupForm] = useState<SupabaseSettings>(getSavedSupabaseSettings());
  const [staffSignIn, setStaffSignIn] = useState({ name: "", initials: "", passcode: "" });
  const [isBusy, setIsBusy] = useState(false);
  const licenseInputRef = useRef<HTMLInputElement | null>(null);
  const agreementInputRef = useRef<HTMLInputElement | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    const local = getLocalRecords();
    setRecords(local);
    setCustomers(buildCustomerProfiles(local));
  }, []);

  useEffect(() => {
    setLocalRecords(records);
  }, [records]);

  useEffect(() => {
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setForm((prev) => ({
        ...prev,
        checkoutInitials: prev.checkoutInitials || session.initials,
      }));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [session]);

  useEffect(() => {
    void connectCloud();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      [
        r.customerName,
        r.contactPhone,
        r.email,
        r.vehicle,
        r.aircraftNNumber,
        r.checkoutInitials,
        r.checkinInitials,
        r.destination,
        r.notes,
        r.lastEditedBy,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [records, search]);

  const activeCount = records.filter((r) => !r.actualReturnAt).length;
  const returnedCount = records.filter((r) => !!r.actualReturnAt).length;
  const vehicleStatus = useMemo(
    () =>
      VEHICLE_OPTIONS.map((vehicle) => ({
        vehicle,
        activeRecord: records.find((r) => r.vehicle === vehicle && !r.actualReturnAt) || null,
      })),
    [records]
  );

  async function connectCloud(customSettings?: SupabaseSettings) {
    const effective = customSettings || settings;
    const client = createSupabase(effective);

    if (!client) {
      supabaseRef.current = null;
      setCloudState("local");
      setCloudMessage("Using local demo mode. Add Supabase settings to make this a shared staff app.");
      return;
    }

    setCloudState("connecting");
    setCloudMessage("Connecting to shared cloud database...");

    try {
      const schemaStatus = await ensureSupabaseSchema(client);
      if (!schemaStatus.ok) {
        supabaseRef.current = client;
        setCloudState("error");
        setCloudMessage(
          "Connected to Supabase, but the required tables are missing. Open setup instructions below."
        );
        return;
      }

      const data = await fetchCloudData(client);
      supabaseRef.current = client;
      setRecords(data.records);
      setCustomers(data.customers.length ? data.customers : buildCustomerProfiles(data.records));
      setCloudState("connected");
      setCloudMessage("Shared cloud database connected. Staff on other devices will see the same records.");
    } catch (error) {
      supabaseRef.current = null;
      setCloudState("error");
      setCloudMessage(error instanceof Error ? error.message : "Unable to connect to the cloud database.");
    }
  }

  async function refreshCloud() {
    if (!supabaseRef.current) {
      await connectCloud();
      return;
    }

    try {
      setIsBusy(true);
      const data = await fetchCloudData(supabaseRef.current);
      setRecords(data.records);
      setCustomers(data.customers.length ? data.customers : buildCustomerProfiles(data.records));
    } catch (error) {
      setCloudState("error");
      setCloudMessage(error instanceof Error ? error.message : "Unable to refresh cloud data.");
    } finally {
      setIsBusy(false);
    }
  }

  function resetForm() {
    setForm(emptyForm(session?.initials || ""));
    setEditingId(null);
    setShowForm(false);
  }

  function openNewForm() {
    setForm(emptyForm(session?.initials || ""));
    setEditingId(null);
    setShowForm(true);
  }

  function applySavedCustomer(customerId: string) {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;

    setForm((prev) => ({
      ...prev,
      customerName: customer.customerName,
      contactPhone: customer.contactPhone,
      email: customer.email,
      driverLicenseCopy: customer.driverLicenseCopy,
      useAgreement: customer.useAgreement,
    }));
  }

  function openEditForm(record: CheckoutRecord) {
    setForm(record);
    setEditingId(record.id);
    setShowForm(true);
  }

  async function persistCloudRecords(nextRecords: CheckoutRecord[], nextCustomers: CustomerProfile[]) {
    if (!supabaseRef.current) return;

    const client = supabaseRef.current;
    const recordsPayload = nextRecords.map((record) => ({ ...record }));
    const customersPayload = nextCustomers.map((customer) => ({ ...customer }));

    const [recordsWrite, customersWrite] = await Promise.all([
      client.from("courtesy_car_records").upsert(recordsPayload, { onConflict: "id" }),
      client.from("courtesy_car_customers").upsert(customersPayload, { onConflict: "id" }),
    ]);

    if (recordsWrite.error) throw new Error(recordsWrite.error.message);
    if (customersWrite.error) throw new Error(customersWrite.error.message);
  }

  async function replaceState(nextRecords: CheckoutRecord[]) {
    const nextCustomers = buildCustomerProfiles(nextRecords);
    setRecords(nextRecords);
    setCustomers(nextCustomers);

    if (cloudState === "connected") {
      await persistCloudRecords(nextRecords, nextCustomers);
    }
  }

  async function saveRecord() {
    if (!session) {
      alert("Please sign in as a staff member first.");
      return;
    }

    if (!form.customerName.trim() || !form.contactPhone.trim() || !form.checkoutAt.trim()) {
      alert("Please fill out customer name, contact phone, and checkout date/time.");
      return;
    }

    try {
      setIsBusy(true);
      const now = new Date().toISOString();
      const preparedForm = normalizeRecord({
        ...form,
        checkoutInitials: sanitizeInitials(form.checkoutInitials || session.initials),
        aircraftNNumber: form.aircraftNNumber.toUpperCase(),
        updatedAt: now,
        lastEditedBy: session.name,
      });

      const nextRecords = editingId
        ? records.map((r) =>
            r.id === editingId
              ? {
                  ...preparedForm,
                  id: editingId,
                  createdAt: r.createdAt,
                }
              : r
          )
        : [
            {
              ...preparedForm,
              id: uid(),
              createdAt: now,
            },
            ...records,
          ];

      await replaceState(nextRecords);
      resetForm();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to save record.");
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteRecord(id: string) {
    const ok = window.confirm("Delete this checkout record?");
    if (!ok) return;

    try {
      setIsBusy(true);
      const nextRecords = records.filter((r) => r.id !== id);
      await replaceState(nextRecords);

      if (supabaseRef.current && cloudState === "connected") {
        const { error } = await supabaseRef.current.from("courtesy_car_records").delete().eq("id", id);
        if (error) throw new Error(error.message);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to delete record.");
      await refreshCloud();
    } finally {
      setIsBusy(false);
    }
  }

  async function markReturned(id: string) {
    if (!session) {
      alert("Please sign in as a staff member first.");
      return;
    }

    const initials = sanitizeInitials(window.prompt("Enter employee initials for check-in:", session.initials) || session.initials);
    const now = new Date().toISOString();

    try {
      setIsBusy(true);
      const nextRecords = records.map((r) =>
        r.id === id
          ? {
              ...r,
              actualReturnAt: now,
              checkinInitials: initials,
              updatedAt: now,
              lastEditedBy: session.name,
            }
          : r
      );
      await replaceState(nextRecords);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to mark vehicle returned.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAttachmentChange(kind: "driverLicenseCopy" | "useAgreement", fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    const attachment = await fileToDataUrl(file);
    setForm((prev) => ({ ...prev, [kind]: attachment }));
  }

  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), records, customers }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "courtesy-car-records.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveSetup() {
    localStorage.setItem(SUPABASE_SETTINGS_KEY, JSON.stringify(setupForm));
    setSettings(getSavedSupabaseSettings());
    setShowSetup(false);
    await connectCloud({
      url: setupForm.url,
      anonKey: setupForm.anonKey,
      staffPasscode: setupForm.staffPasscode,
    });
  }

  function signInStaff() {
    const expectedPasscode = getSavedSupabaseSettings().staffPasscode.trim();
    if (expectedPasscode && staffSignIn.passcode !== expectedPasscode) {
      alert("Incorrect staff passcode.");
      return;
    }

    if (!staffSignIn.name.trim() || !staffSignIn.initials.trim()) {
      alert("Enter staff name and initials.");
      return;
    }

    const nextSession = {
      name: staffSignIn.name.trim(),
      initials: sanitizeInitials(staffSignIn.initials),
      signedInAt: new Date().toISOString(),
    };
    setSession(nextSession);
    setStaffSignIn({ name: "", initials: "", passcode: "" });
  }

  function signOutStaff() {
    setSession(null);
    resetForm();
  }

  const statusPill =
    cloudState === "connected"
      ? "bg-emerald-100 text-emerald-700"
      : cloudState === "connecting"
        ? "bg-blue-100 text-blue-700"
        : cloudState === "error"
          ? "bg-rose-100 text-rose-700"
          : "bg-amber-100 text-amber-700";

  const StatusIcon =
    cloudState === "connected" ? Wifi : cloudState === "connecting" ? RefreshCw : cloudState === "error" ? AlertCircle : WifiOff;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 md:p-8">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 rounded-2xl bg-slate-100">
                  <Car className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold">Courtesy Car Staff App</h1>
                  <p className="text-slate-600 mt-1">Shared checkout tracking for front desk staff.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${statusPill}`}>
                  <StatusIcon className={`w-4 h-4 ${cloudState === "connecting" ? "animate-spin" : ""}`} />
                  {cloudState === "connected"
                    ? "Shared cloud mode"
                    : cloudState === "connecting"
                      ? "Connecting"
                      : cloudState === "error"
                        ? "Setup needed"
                        : "Local demo mode"}
                </span>
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm bg-slate-100 text-slate-700">
                  <Cloud className="w-4 h-4" /> {cloudMessage}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 items-start xl:justify-end">
              {session ? (
                <div className="rounded-2xl border border-slate-200 p-3 bg-slate-50 min-w-[220px]">
                  <div className="text-sm text-slate-500">Signed in staff</div>
                  <div className="font-semibold">{session.name}</div>
                  <div className="text-sm text-slate-600">Initials: {session.initials}</div>
                  <button
                    onClick={signOutStaff}
                    className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-slate-300 hover:bg-white"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 p-3 bg-slate-50 min-w-[280px] space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2"><KeyRound className="w-4 h-4" /> Staff Sign In</div>
                  <input
                    className="input"
                    placeholder="Staff name"
                    value={staffSignIn.name}
                    onChange={(e) => setStaffSignIn((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input"
                      placeholder="Initials"
                      value={staffSignIn.initials}
                      onChange={(e) => setStaffSignIn((prev) => ({ ...prev, initials: sanitizeInitials(e.target.value) }))}
                    />
                    <input
                      className="input"
                      type="password"
                      placeholder="Passcode"
                      value={staffSignIn.passcode}
                      onChange={(e) => setStaffSignIn((prev) => ({ ...prev, passcode: e.target.value }))}
                    />
                  </div>
                  <button onClick={signInStaff} className="px-4 py-2 rounded-2xl bg-slate-900 text-white hover:opacity-90">
                    Sign In
                  </button>
                </div>
              )}

              <button
                onClick={() => setShowSetup((prev) => !prev)}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-slate-300 hover:bg-slate-50"
              >
                <Cloud className="w-4 h-4" /> Cloud Setup
              </button>
              <button
                onClick={refreshCloud}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-slate-300 hover:bg-slate-50"
              >
                <RefreshCw className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`} /> Refresh
              </button>
              <button
                onClick={exportData}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-slate-300 hover:bg-slate-50"
              >
                <Download className="w-4 h-4" /> Export Data
              </button>
              <button
                onClick={openNewForm}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-900 text-white hover:opacity-90"
              >
                <Plus className="w-4 h-4" /> New Checkout
              </button>
            </div>
          </div>
        </div>

        {showSetup && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Shared Cloud Setup</h2>
                <p className="text-slate-600 mt-1">Use Supabase so every staff device sees the same records.</p>
              </div>
              <button onClick={saveSetup} className="px-4 py-3 rounded-2xl bg-slate-900 text-white hover:opacity-90">
                Save & Connect
              </button>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="font-semibold mb-1">Recommended permanent setup</div>
              <p>
                Put your Supabase URL, anon key, and staff passcode into Vercel environment variables named
                <code className="mx-1">VITE_SUPABASE_URL</code>,
                <code className="mx-1">VITE_SUPABASE_ANON_KEY</code>, and
                <code className="mx-1">VITE_STAFF_PASSCODE</code>.
                When those are present, this app will use them automatically on every device.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Supabase URL">
                <input
                  className="input"
                  placeholder="https://your-project.supabase.co"
                  value={setupForm.url}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, url: e.target.value.trim() }))}
                />
              </Field>
              <Field label="Supabase Anon Key">
                <input
                  className="input"
                  placeholder="Paste anon key"
                  value={setupForm.anonKey}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, anonKey: e.target.value.trim() }))}
                />
              </Field>
              <Field label="Staff Passcode">
                <input
                  className="input"
                  type="password"
                  placeholder="Optional front desk passcode"
                  value={setupForm.staffPasscode}
                  onChange={(e) => setSetupForm((prev) => ({ ...prev, staffPasscode: e.target.value }))}
                />
              </Field>
            </div>

            <div className="rounded-3xl bg-slate-50 border border-slate-200 p-5 text-sm leading-6">
              <div className="font-semibold mb-2">Create these Supabase tables</div>
              <pre className="whitespace-pre-wrap overflow-x-auto text-xs bg-slate-900 text-slate-100 rounded-2xl p-4">{`create table if not exists courtesy_car_records (
  id text primary key,
  customerName text,
  contactPhone text,
  email text,
  vehicle text,
  aircraftNNumber text,
  checkoutInitials text,
  checkinInitials text,
  checkoutAt text,
  expectedReturnAt text,
  actualReturnAt text,
  destination text,
  notes text,
  createdAt text,
  updatedAt text,
  driverLicenseCopy jsonb,
  useAgreement jsonb,
  lastEditedBy text
);

create table if not exists courtesy_car_customers (
  id text primary key,
  customerName text,
  contactPhone text,
  email text,
  driverLicenseCopy jsonb,
  useAgreement jsonb,
  updatedAt text
);`}</pre>
              <p className="mt-3 text-slate-600">
                After that, save the URL and anon key here. For a permanent multi-device setup, add the same values to Vercel environment variables and redeploy.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard icon={<Users className="w-5 h-5" />} label="Active Checkouts" value={String(activeCount)} />
          <StatCard icon={<ShieldCheck className="w-5 h-5" />} label="Returned" value={String(returnedCount)} />
          <StatCard icon={<CalendarClock className="w-5 h-5" />} label="Retention" value="1 year" />
          <StatCard icon={<Cloud className="w-5 h-5" />} label="Saved Customers" value={String(customers.length)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {vehicleStatus.map((item) => (
            <div key={item.vehicle} className="bg-white rounded-3xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-500">Vehicle</div>
                  <div className="text-xl font-semibold">{item.vehicle}</div>
                </div>
                <span
                  className={`inline-flex px-3 py-1 rounded-full text-sm ${
                    item.activeRecord ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {item.activeRecord ? "Out" : "Available"}
                </span>
              </div>
              {item.activeRecord ? (
                <div className="mt-3 text-sm text-slate-600">
                  {item.activeRecord.customerName} • due {formatDateTime(item.activeRecord.expectedReturnAt)}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-600">Ready for checkout.</div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-4 md:p-5">
          <div className="flex items-center gap-3 border border-slate-200 rounded-2xl px-4 py-3">
            <Search className="w-5 h-5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, phone, vehicle, initials, destination, notes, or staff..."
              className="w-full outline-none bg-transparent"
            />
          </div>
        </div>

        {showForm && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold">{editingId ? "Edit Checkout" : "New Checkout"}</h2>
              <button onClick={resetForm} className="px-4 py-2 rounded-2xl border border-slate-300 hover:bg-slate-50">
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <Field label="Reuse Existing Customer">
                <select
                  className="input"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) applySavedCustomer(e.target.value);
                  }}
                >
                  <option value="">Select saved customer...</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customerName} {customer.contactPhone ? `- ${customer.contactPhone}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Customer Name">
                <input className="input" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
              </Field>
              <Field label="Contact Phone">
                <input className="input" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Vehicle">
                <select className="input" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })}>
                  {VEHICLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Aircraft N Number">
                <input
                  className="input"
                  value={form.aircraftNNumber}
                  onChange={(e) => setForm({ ...form, aircraftNNumber: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Destination">
                <input className="input" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
              </Field>
              <Field label="Employee Initials (Checkout)">
                <input
                  className="input"
                  value={form.checkoutInitials}
                  onChange={(e) => setForm({ ...form, checkoutInitials: sanitizeInitials(e.target.value) })}
                />
              </Field>
              <Field label="Checkout Date & Time">
                <input
                  type="datetime-local"
                  className="input"
                  value={form.checkoutAt}
                  onChange={(e) => setForm({ ...form, checkoutAt: e.target.value })}
                />
              </Field>
              <Field label="Expected Return Date & Time">
                <input
                  type="datetime-local"
                  className="input"
                  value={form.expectedReturnAt}
                  onChange={(e) => setForm({ ...form, expectedReturnAt: e.target.value })}
                />
              </Field>
              <Field label="Actual Return Date & Time">
                <input
                  type="datetime-local"
                  className="input"
                  value={form.actualReturnAt}
                  onChange={(e) => setForm({ ...form, actualReturnAt: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Notes">
              <textarea className="input min-h-[110px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UploadCard
                title="Driver License Copy"
                buttonLabel="Upload File"
                attachmentName={form.driverLicenseCopy?.name || "No file attached"}
                onClick={() => licenseInputRef.current?.click()}
              >
                <input
                  ref={licenseInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf"
                  onChange={(e) => void handleAttachmentChange("driverLicenseCopy", e.target.files)}
                />
              </UploadCard>
              <UploadCard
                title="Use Agreement"
                buttonLabel="Upload File"
                attachmentName={form.useAgreement?.name || "No file attached"}
                onClick={() => agreementInputRef.current?.click()}
              >
                <input
                  ref={agreementInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf"
                  onChange={(e) => void handleAttachmentChange("useAgreement", e.target.files)}
                />
              </UploadCard>
            </div>

            <div className="flex justify-end">
              <button onClick={() => void saveRecord()} className="px-5 py-3 rounded-2xl bg-slate-900 text-white hover:opacity-90">
                {editingId ? "Save Changes" : "Save Checkout"}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10 text-center text-slate-500">No records found.</div>
          ) : (
            filtered.map((record) => {
              const overdue = !record.actualReturnAt && record.expectedReturnAt && new Date(record.expectedReturnAt).getTime() < Date.now();
              return (
                <div
                  key={record.id}
                  className={`bg-white rounded-3xl shadow-sm border p-5 md:p-6 ${
                    overdue ? "border-rose-300 bg-rose-50/40" : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                    <div className="space-y-3 flex-1">
                      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                        <h3 className="text-2xl font-semibold">{record.customerName}</h3>
                        <span
                          className={`inline-flex w-fit px-3 py-1 rounded-full text-sm ${
                            record.actualReturnAt
                              ? "bg-emerald-100 text-emerald-700"
                              : overdue
                                ? "bg-rose-100 text-rose-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {record.actualReturnAt ? "Returned" : overdue ? "Overdue" : "Checked Out"}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm text-slate-700">
                        <Info icon={<Phone className="w-4 h-4" />} label="Phone" value={record.contactPhone || "—"} />
                        <Info icon={<Car className="w-4 h-4" />} label="Vehicle" value={record.vehicle || "—"} />
                        <Info icon={<CalendarClock className="w-4 h-4" />} label="Checkout" value={formatDateTime(record.checkoutAt)} />
                        <Info label="Out By" value={record.checkoutInitials || "—"} />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm text-slate-700">
                        <Info icon={<CalendarClock className="w-4 h-4" />} label="Expected Return" value={formatDateTime(record.expectedReturnAt)} />
                        <Info label="Actual Return" value={formatDateTime(record.actualReturnAt)} />
                        <Info label="In By" value={record.checkinInitials || "—"} />
                        <Info label="Email" value={record.email || "—"} />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm text-slate-700">
                        <Info label="Aircraft N Number" value={record.aircraftNNumber || "—"} />
                        <Info label="Destination" value={record.destination || "—"} />
                        <Info label="Last Updated" value={formatDateTime(record.updatedAt)} />
                        <Info label="Edited By" value={record.lastEditedBy || "—"} />
                      </div>

                      {record.notes ? (
                        <div>
                          <div className="text-sm font-medium text-slate-500 mb-1">Notes</div>
                          <p className="text-slate-700 whitespace-pre-wrap">{record.notes}</p>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-3 text-sm">
                        <AttachmentBadge attachment={record.driverLicenseCopy} label="Driver License" />
                        <AttachmentBadge attachment={record.useAgreement} label="Use Agreement" />
                      </div>
                    </div>

                    <div className="flex xl:flex-col gap-2">
                      <button onClick={() => openEditForm(record)} className="px-4 py-2 rounded-2xl border border-slate-300 hover:bg-slate-50">
                        Edit
                      </button>
                      {!record.actualReturnAt && (
                        <button onClick={() => void markReturned(record.id)} className="px-4 py-2 rounded-2xl bg-slate-900 text-white hover:opacity-90">
                          Mark Returned
                        </button>
                      )}
                      <button
                        onClick={() => void deleteRecord(record.id)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          border: 1px solid rgb(226 232 240);
          border-radius: 1rem;
          padding: 0.8rem 0.95rem;
          outline: none;
          background: white;
        }
        .input:focus {
          border-color: rgb(15 23 42);
          box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-center gap-3 text-slate-600 mb-2">
        {icon} {label}
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
}

function Info({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
      <div className="flex items-center gap-2 text-slate-500 text-xs uppercase tracking-wide mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-medium text-slate-900 break-words">{value}</div>
    </div>
  );
}

function UploadCard({
  title,
  buttonLabel,
  attachmentName,
  onClick,
  children,
}: {
  title: string;
  buttonLabel: string;
  attachmentName: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-slate-300 rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-3 font-medium">
        <Upload className="w-4 h-4" /> {title}
      </div>
      {children}
      <button type="button" onClick={onClick} className="px-4 py-2 rounded-2xl border border-slate-300 hover:bg-slate-50">
        {buttonLabel}
      </button>
      <p className="text-sm text-slate-600 mt-3">{attachmentName}</p>
    </div>
  );
}

function AttachmentBadge({ attachment, label }: { attachment: Attachment | null; label: string }) {
  if (!attachment) {
    return <span className="px-3 py-2 rounded-2xl bg-slate-100 text-slate-500">{label}: none</span>;
  }

  return (
    <a
      href={attachment.dataUrl}
      download={attachment.name}
      className="px-3 py-2 rounded-2xl bg-slate-900 text-white hover:opacity-90"
    >
      {label}: {attachment.name}
    </a>
  );
}

console.assert(VEHICLE_OPTIONS.length === 3, "Vehicle dropdown should contain 3 options");
console.assert(emptyForm().vehicle === "Tahoe 1", "Default vehicle should be Tahoe 1");
console.assert(sanitizeInitials("e.h.") === "EH", "Initials should sanitize correctly");
console.assert(buildCustomerProfiles([]).length === 0, "No records should produce no customer profiles");
console.assert(typeof getSavedSupabaseSettings().url === "string", "Supabase settings should always return strings");
