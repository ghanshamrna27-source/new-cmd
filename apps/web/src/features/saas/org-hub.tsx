import { useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  InviteMembersResponseSchema,
  RequestRoleOtpResponseSchema,
  ResetPasswordResponseSchema,
  roleDraftFromGrants,
  TemplateListSchema,
  type Capability,
  type SaasWorkspace,
  type TemplateSummary,
} from "@orbit/contracts";
import { AccessPanel, type IssuedSet } from "./access-panel";
import { request } from "./client";
import { domainTitle } from "./domains";
import { parseEmails } from "./emails";
import { OrgKpis } from "./org-kpis";
import { initialOf } from "./identity";
import {
  LayoutDashboard,
  ShieldCheck,
  BarChart3,
  Users,
  Building2,
  Plus,
  KeyRound,
  Eye,
  EyeOff,
  UserPlus,
  Edit2,
  Trash2,
  CheckSquare,
  Upload,
  ShieldAlert,
  Settings2,
  Lock,
  Mail,
  User,
  Globe,
  RefreshCw,
  X,
  UserCog,
  UserMinus,
  Shield,
} from "lucide-react";

type Change = (path: string, body: unknown) => Promise<boolean>;
type Section = "Overview" | "Roles & Permissions" | "KPIs (Predefined & Custom)" | "People & Logins" | "Units & Structure";
const SECTIONS: Section[] = ["Overview", "Roles & Permissions", "KPIs (Predefined & Custom)", "People & Logins", "Units & Structure"];

const CAPABILITIES: { key: Capability; label: string; help: string }[] = [
  { key: "view", label: "See results", help: "Sees the chosen KPIs on their dashboard and in Ask." },
  { key: "act", label: "Assign actions", help: "Can turn a result into an action for someone to follow up." },
  { key: "submit", label: "Upload data", help: "Can download the CSV format and upload figures." },
  { key: "approve", label: "Approve data", help: "Checks uploaded figures and publishes the results." },
  { key: "configure", label: "Set up KPIs and units", help: "Can add units, inputs and draft KPIs for the whole organization." },
];
const capabilityLabel = (c: Capability) => CAPABILITIES.find((x) => x.key === c)?.label ?? c;

/**
 * The owner's home: run the organization without asking anyone. Rename it, see
 * what is left to set up, decide what every role can do and see, manage people
 * and the unit structure.
 */
export function OrgHub({
  workspace: w,
  change,
  goto,
  governance,
  tenant,
  reload,
  initialSection = "Overview",
}: {
  workspace: SaasWorkspace;
  change: Change;
  /** The organization's id, for calls that do not go through `change`. */
  tenant: string;
  /** Reloads the workspace after a change made outside `change`. */
  reload: () => Promise<void>;
  /** Opens another workspace tab, such as "KPI library". */
  goto: (tab: "KPI library" | "Data & approvals" | "Dashboard") => void;
  /** Approval policy and setup proposals, owned by the page. */
  governance?: ReactNode;
  /** Initial section to open */
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);

  useEffect(() => {
    if (initialSection) {
      setSection(initialSection);
    }
  }, [initialSection]);

  const sectionConfig: Record<Section, { label: string; icon: typeof LayoutDashboard; count?: number }> = {
    Overview: { label: "Overview", icon: LayoutDashboard },
    "Roles & Permissions": { label: "Roles & Permissions", icon: ShieldCheck, count: w.roles.length },
    "KPIs (Predefined & Custom)": { label: "KPIs (Catalog & Custom)", icon: BarChart3, count: w.kpis.length },
    "People & Logins": { label: "Team & Logins", icon: Users, count: w.members.length },
    "Units & Structure": { label: "Units & Structure", icon: Building2, count: w.units.length },
  };

  return (
    <div className="hub-content-container">
      <nav className="hub-tabs" aria-label="Organization">
        {SECTIONS.map((s) => {
          const cfg = sectionConfig[s];
          const IconComp = cfg.icon;
          return (
            <button
              key={s}
              type="button"
              className={s === section ? "selected" : ""}
              aria-current={s === section ? "page" : undefined}
              onClick={() => setSection(s)}
            >
              <IconComp size={15} />
              <span>{cfg.label}</span>
              {typeof cfg.count === "number" && (
                <span className="tab-badge">{cfg.count}</span>
              )}
            </button>
          );
        })}
      </nav>
      {section === "Overview" && <Overview w={w} change={change} goto={goto} open={setSection} governance={governance} />}
      {section === "Roles & Permissions" && <Roles w={w} change={change} tenant={tenant} reload={reload} />}
      {section === "KPIs (Predefined & Custom)" && <OrgKpis workspace={w} change={change} reload={reload} />}
      {section === "People & Logins" && <People w={w} change={change} tenant={tenant} reload={reload} />}
      {section === "Units & Structure" && <Units w={w} change={change} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Overview({
  w,
  change,
  goto,
  open,
  governance,
}: {
  w: SaasWorkspace;
  change: Change;
  goto: (tab: "KPI library" | "Data & approvals" | "Dashboard") => void;
  open: (s: Section) => void;
  governance: ReactNode;
}) {
  const [name, setName] = useState(w.organization.name);
  const active = w.kpis.filter((k) => k.state === "active");
  const withTarget = active.filter((k) => k.target !== null).length;
  const people = w.members.filter((m) => m.active && !m.owner);
  const peopleWithRoles = people.filter((m) => m.roleIds.length > 0).length;
  const fresh = w.kpis.length === 0 && w.roles.length === 0;
  const steps: { done: boolean; title: string; detail: string; action: () => void; cta: string }[] = [
    {
      done: !fresh,
      title: "Starting point",
      detail: fresh
        ? "Start from an industry template, or build your roles and KPIs yourself."
        : `${w.kpis.length} KPIs and ${w.roles.length} roles. Change any of them at any time.`,
      action: () => (fresh ? document.getElementById("starting-point")?.scrollIntoView({ behavior: "smooth" }) : open("KPIs (Predefined & Custom)")),
      cta: fresh ? "Choose" : "KPIs",
    },
    {
      done: w.units.length > 1,
      title: "Your structure",
      detail: w.units.length > 1 ? `${w.units.length} units` : "Add branches, sites or departments, so figures can be reported and rolled up per unit.",
      action: () => open("Units & Structure"),
      cta: "Units",
    },
    {
      done: w.roles.length > 0,
      title: "Roles and what they see",
      detail: w.roles.length ? `${w.roles.length} roles` : "Create roles and choose which KPIs each one sees.",
      action: () => open("Roles & Permissions"),
      cta: "Roles & Permissions",
    },
    {
      done: people.length > 0 && peopleWithRoles === people.length,
      title: "People with roles",
      detail: people.length ? `${peopleWithRoles} of ${people.length} people have a role` : "Invite your team and give each person a role.",
      action: () => open("People & Logins"),
      cta: "People & Logins",
    },
    {
      done: active.length > 0 && withTarget === active.length,
      title: "Targets",
      detail: active.length ? `${withTarget} of ${active.length} KPIs have a target. Without one, nothing can be on or off target.` : "Add KPIs first.",
      action: () => open("KPIs (Predefined & Custom)"),
      cta: "Set KPIs & Targets",
    },
    {
      done: w.results.length > 0,
      title: "First figures",
      detail: w.results.length ? "Results are being calculated." : "Upload a CSV for a reporting period and approve it.",
      action: () => goto("Data & approvals"),
      cta: "Data & approvals",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      {fresh && <StartingPoint change={change} open={open} />}
      <div className="saas-columns">
        <section className="saas-card">
          <h2>Organization details</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void change("/organization", { name });
            }}
          >
            <label>
              Organization name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </label>
            <button disabled={!name.trim() || name.trim() === w.organization.name}>Save name</button>
          </form>
          <div className="saas-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginTop: 18 }}>
            <div><span>People</span><strong>{people.length + 1}</strong></div>
            <div><span>Roles</span><strong>{w.roles.length}</strong></div>
            <div><span>Active KPIs</span><strong>{active.length}</strong></div>
            <div><span>Units</span><strong>{w.units.length}</strong></div>
          </div>
        </section>
        <section className="saas-card">
          <div className="saas-card-title">
            <h2>Getting set up</h2>
            <span className={`saas-badge ${doneCount === steps.length ? "good" : ""}`}>{doneCount} of {steps.length} done</span>
          </div>
          <ol className="check-list">
            {steps.map((s) => (
              <li key={s.title} className={s.done ? "done" : ""}>
                <span className="check-mark" aria-hidden="true">{s.done ? "✓" : ""}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p className="muted">{s.detail}</p>
                </div>
                <button type="button" className="secondary" onClick={s.action}>{s.cta}</button>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {governance}
    </>
  );
}

/**
 * Shown while the organization has no KPIs and no roles: the owner decides how
 * to begin. A template brings KPIs, roles and what each role sees; every part of
 * it can be changed afterwards. Or the owner builds everything themselves.
 */
function StartingPoint({
  change,
  open,
}: {
  change: Change;
  open: (s: Section) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [chosen, setChosen] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request("/api/saas/templates", TemplateListSchema)
      .then((rows) => active && setTemplates(rows))
      .catch((e: unknown) => active && setProblem(e instanceof Error ? e.message : "Templates could not be loaded."));
    return () => {
      active = false;
    };
  }, []);
  const industries = useMemo(() => [...new Set(templates.map((t) => t.industry))], [templates]);
  const template = templates.find((t) => t.id === chosen);

  return (
    <section className="saas-card" id="starting-point">
      <h2>Choose your starting point</h2>
      <p>
        Your organization is ready and empty. Start from an industry template (its KPIs, roles and what each role sees), then
        change anything you like. Or build your own roles and KPIs from the KPI library.
      </p>
      <label>
        Industry template
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Choose a template…</option>
          {industries.map((industry) => (
            <optgroup key={industry} label={industry.replaceAll("_", " ")}>
              {templates
                .filter((t) => t.industry === industry)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {template && (
        <div className="console-template">
          <strong>{template.name}</strong>
          <span>{template.description}</span>
          <span className="muted">
            {template.kpiCount} KPIs and {template.roles.length} roles: {template.roles.map((r) => r.name).join(", ")}.
          </span>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button
          type="button"
          disabled={!template || busy}
          onClick={() => {
            setBusy(true);
            void change("/template", { templateId: chosen }).finally(() => setBusy(false));
          }}
        >
          {busy ? "Setting up…" : "Use this template"}
        </button>
        <button type="button" className="secondary" onClick={() => open("KPIs (Predefined & Custom)")}>
          🌟 Pick Predefined &amp; Custom KPIs
        </button>
        <button type="button" className="secondary" onClick={() => open("Roles & Permissions")}>
          👤 Set Up Roles &amp; Permissions
        </button>
      </div>
      {problem && <p className="muted">{problem}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface Editing {
  roleId?: string;
  name: string;
  capabilities: Capability[];
  scopeUnitId: string | null;
  allKpis: boolean;
  kpiIds: string[];
  custom: boolean;
}

function makeRandomPassword(): string {
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const LOWER = "abcdefghijkmnpqrstuvwxyz";
  const DIGITS = "23456789";
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)]!;
  const chars = [pick(UPPER), pick(UPPER), pick(UPPER), pick(LOWER), pick(LOWER), pick(LOWER), pick(LOWER), pick(DIGITS), pick(DIGITS), pick(DIGITS)];
  const all = UPPER + LOWER + DIGITS;
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  const text = chars.join("");
  return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}`;
}

function Roles({
  w,
  change,
  tenant,
  reload,
}: {
  w: SaasWorkspace;
  change: Change;
  tenant: string;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Editing>();
  const [addingRoleId, setAddingRoleId] = useState<string>();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [issuedForRole, setIssuedForRole] = useState<{ roleId: string; set: IssuedSet }>();

  const [resettingMemberId, setResettingMemberId] = useState<string>();
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const [editingMemberId, setEditingMemberId] = useState<string>();
  const [editingMemberRoles, setEditingMemberRoles] = useState<string[]>([]);

  const canCreateLogins = true;
  const roleName = new Map(w.roles.map((r) => [r.id, r.name]));
  const holders = (roleId: string) => w.members.filter((m) => m.active && m.roleIds.includes(roleId)).length;
  const unitName = (id: string | null) => (id ? w.units.find((u) => u.id === id)?.name ?? "a unit" : "The whole organization");
  const kpiName = new Map(w.kpis.map((k) => [k.id, k.name]));

  function edit(roleId?: string) {
    const role = w.roles.find((r) => r.id === roleId);
    if (!role) {
      setEditing({ name: "", capabilities: ["view"], scopeUnitId: null, allKpis: false, kpiIds: [], custom: false });
      return;
    }
    const draft = roleDraftFromGrants(role.grants);
    setEditing({ roleId: role.id, name: role.name, ...draft });
  }

  async function handleCreateRoleLogin(roleId: string, roleNameStr: string) {
    if (!loginName.trim() || !loginEmail.trim() || loginPassword.length < 8) return;
    setLoginBusy(true);
    setLoginError("");
    setIssuedForRole(undefined);
    try {
      const result = await request(
        `/api/identity/organizations/${tenant}/people`,
        InviteMembersResponseSchema,
        {
          members: [{
            displayName: loginName.trim(),
            email: loginEmail.trim(),
            roleIds: [roleId],
            password: loginPassword.trim() || undefined,
          }],
        }
      );
      setIssuedForRole({
        roleId,
        set: {
          title: `Credentials created for ${roleNameStr}`,
          mode: result.mode,
          people: result.members,
        },
      });
      setLoginName("");
      setLoginEmail("");
      setLoginPassword(makeRandomPassword());
      setAddingRoleId(undefined);
      await reload();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to create login.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleResetPassword(member: SaasWorkspace["members"][number], roleId: string) {
    const who = member.email ?? member.displayName;
    if (resetPasswordValue.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
    setResetBusy(true);
    try {
      const result = await request(
        `/api/identity/organizations/${tenant}/members/${member.id}/reset-password`,
        ResetPasswordResponseSchema,
        { password: resetPasswordValue.trim() || undefined }
      );
      setIssuedForRole({
        roleId,
        set: {
          title: `New credentials for ${who}`,
          mode: "logins",
          people: [{
            email: who,
            roleKeys: member.roleIds,
            temporaryPassword: result.temporaryPassword,
          }],
        },
      });
      setResettingMemberId(undefined);
      await reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to change credentials.");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="roles-section-wrap">
      <section className="roles-hero-card">
        <div className="roles-hero-title">
          <div className="roles-hero-icon">
            <ShieldCheck size={28} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: 9999, color: "#ffffff" }}>
                Enterprise Access Control
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd" }}>
                ● {w.roles.length} Active Role Profiles
              </span>
            </div>
            <h2>Role-Scoped Permissions &amp; Access</h2>
            <p>
              Each role strictly governs what operational data a team member can view, which KPIs they monitor, and what administrative actions they can take across {w.organization.name}.
            </p>
          </div>
        </div>
        <button type="button" className="roles-hero-btn" onClick={() => edit()}>
          <Plus size={16} />
          <span>Create New Role</span>
        </button>
      </section>

      {editing && !editing.roleId && (
        <RoleEditor
          w={w}
          change={change}
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(undefined)}
          tenant={tenant}
          onRoleCreated={async (roleId, _name, issued) => {
            if (issued) {
              setIssuedForRole({ roleId, set: issued });
            }
            await reload();
          }}
        />
      )}

      <div className="role-list">
        {w.roles.map((role) => {
          const draft = roleDraftFromGrants(role.grants);
          const count = holders(role.id);
          const isOpen = editing?.roleId === role.id;
          const sees = draft.capabilities.some((c) => c === "view" || c === "act" || c === "submit");
          const isAddingLogin = addingRoleId === role.id;
          const roleMembers = w.members.filter((m) => m.roleIds.includes(role.id));

          return (
            <section key={role.id} className={`role-card ${isOpen ? "open" : ""}`}>
              <div className="saas-card-title" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                      color: "#1d4ed8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      boxShadow: "0 2px 6px rgba(37,99,235,0.12)",
                    }}
                  >
                    <Shield size={22} />
                  </div>
                  <div>
                    <h3>{role.name}</h3>
                    <div className="role-meta-row">
                      <span className="role-meta-pill">
                        <Users size={12} color="#3b82f6" />
                        <span>{count} {count === 1 ? "member" : "members"}</span>
                      </span>
                      <span className="role-meta-pill">
                        <Globe size={12} color="#10b981" />
                        <span>{unitName(draft.scopeUnitId)}</span>
                      </span>
                      {sees && (
                        <span className="role-meta-pill">
                          <BarChart3 size={12} color="#8b5cf6" />
                          <span>{draft.allKpis ? "Every KPI in Catalog" : `${draft.kpiIds.length} Assigned KPIs`}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {canCreateLogins && (
                    <button
                      type="button"
                      className="role-btn-secondary"
                      style={{
                        background: isAddingLogin ? "#1e40af" : "#eff6ff",
                        color: isAddingLogin ? "#ffffff" : "#1d4ed8",
                        borderColor: isAddingLogin ? "#1e40af" : "#bfdbfe",
                        fontWeight: 700,
                      }}
                      onClick={() => {
                        if (isAddingLogin) {
                          setAddingRoleId(undefined);
                        } else {
                          setAddingRoleId(role.id);
                          setLoginEmail("");
                          setLoginPassword(makeRandomPassword());
                          setLoginError("");
                        }
                      }}
                    >
                      {isAddingLogin ? <X size={14} /> : <UserPlus size={14} />}
                      <span>{isAddingLogin ? "Close Form" : "+ Add Employee Login"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="role-btn-secondary"
                    onClick={() => (isOpen ? setEditing(undefined) : edit(role.id))}
                  >
                    <Edit2 size={13} />
                    <span>{isOpen ? "Close" : "Edit Role"}</span>
                  </button>
                  <button
                    type="button"
                    className="role-btn-secondary"
                    disabled={count > 0}
                    title={count > 0 ? "Move these people to another role first" : undefined}
                    style={{ color: count > 0 ? "#94a3b8" : "#dc2626", borderColor: count > 0 ? "#e2e8f0" : "#fecaca" }}
                    onClick={() => {
                      if (window.confirm(`Delete the role "${role.name}"?`)) void change(`/roles/${role.id}/delete`, {});
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* Capability Chips */}
              <div className="chip-row">
                {draft.capabilities.length === 0 && (
                  <span className="cap-badge cap-badge-configure">No capabilities granted yet</span>
                )}
                {draft.capabilities.map((c) => {
                  if (c === "view") {
                    return (
                      <span key={c} className="cap-badge cap-badge-view">
                        <Eye size={12} />
                        <span>See Results</span>
                      </span>
                    );
                  }
                  if (c === "act") {
                    return (
                      <span key={c} className="cap-badge cap-badge-act">
                        <CheckSquare size={12} />
                        <span>Assign Actions</span>
                      </span>
                    );
                  }
                  if (c === "submit") {
                    return (
                      <span key={c} className="cap-badge cap-badge-submit">
                        <Upload size={12} />
                        <span>Upload Data</span>
                      </span>
                    );
                  }
                  if (c === "approve") {
                    return (
                      <span key={c} className="cap-badge cap-badge-approve">
                        <ShieldAlert size={12} />
                        <span>Approve Data</span>
                      </span>
                    );
                  }
                  return (
                    <span key={c} className="cap-badge cap-badge-configure">
                      <Settings2 size={12} />
                      <span>{capabilityLabel(c)}</span>
                    </span>
                  );
                })}
              </div>

              {sees && !draft.allKpis && !isOpen && (
                <details style={{ marginTop: 12, padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #f1f5f9" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12.5, color: "#475569" }}>
                    Which KPIs ({draft.kpiIds.length})
                  </summary>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                    {draft.kpiIds.map((id) => kpiName.get(id) ?? "Retired KPI").join(" · ")}
                  </p>
                </details>
              )}

              {/* Add login credentials panel for this role */}
              {isAddingLogin && (
                <div className="role-add-login-panel animate-in fade-in">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "#dbeafe", color: "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <KeyRound size={17} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#1e3a8a" }}>
                        Add Employee Login for {role.name}
                      </h4>
                      <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#64748b" }}>
                        Generate authorized workspace credentials for this role. You can provide these credentials directly to the team member.
                      </p>
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleCreateRoleLogin(role.id, role.name);
                    }}
                    style={{ marginTop: 16 }}
                  >
                    <div className="role-form-grid">
                      <div className="role-field">
                        <label className="role-field-label">
                          <User size={13} color="#2563eb" />
                          <span>Full Name</span>
                        </label>
                        <input
                          className="role-input"
                          type="text"
                          required
                          maxLength={120}
                          placeholder="e.g. Rahul Mehta"
                          value={loginName}
                          onChange={(e) => setLoginName(e.target.value)}
                        />
                      </div>
                      <div className="role-field">
                        <label className="role-field-label">
                          <Mail size={13} color="#2563eb" />
                          <span>Employee Work Email</span>
                        </label>
                        <input
                          className="role-input"
                          type="email"
                          required
                          placeholder="e.g. rahul.m@beingsocial.demo"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="role-field" style={{ marginTop: 14 }}>
                      <label className="role-field-label">
                        <Lock size={13} color="#2563eb" />
                        <span>Temporary Password</span>
                      </label>
                      <div className="role-pwd-wrap">
                        <input
                          className="role-input"
                          type={showPassword ? "text" : "password"}
                          required
                          minLength={8}
                          placeholder="Min 8 characters"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="role-pwd-btn"
                          title="Generate a secure temporary password"
                          onClick={() => setLoginPassword(makeRandomPassword())}
                        >
                          <RefreshCw size={13} />
                          <span>Random</span>
                        </button>
                        <button
                          type="button"
                          className="role-pwd-btn"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                          <span>{showPassword ? "Hide" : "Show"}</span>
                        </button>
                      </div>
                      <small style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        Minimum 8 characters. The employee will sign in with this temporary password.
                      </small>
                    </div>

                    {loginError && (
                      <p role="alert" style={{ margin: "12px 0 0", padding: "8px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 13, fontWeight: 600 }}>
                        {loginError}
                      </p>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
                      <button
                        type="submit"
                        className="role-btn-primary"
                        disabled={loginBusy || !loginName.trim() || !loginEmail.trim() || loginPassword.length < 8}
                      >
                        <UserPlus size={15} />
                        <span>{loginBusy ? "Provisioning Login…" : "Create Employee Login"}</span>
                      </button>
                      <button
                        type="button"
                        className="role-btn-secondary"
                        onClick={() => setAddingRoleId(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Show newly issued credentials banner for this role */}
              {issuedForRole?.roleId === role.id && (
                <div className="role-issued-credentials">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ color: "var(--good)" }}>✓ Credentials created — ready to provide to employee</strong>
                    <button type="button" className="role-btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setIssuedForRole(undefined)}>
                      Done
                    </button>
                  </div>
                  <AccessPanel set={issuedForRole.set} roleName={(key) => roleName.get(key) ?? key} />
                </div>
              )}

              {/* People assigned to this role */}
              <div className="role-members-box">
                <div className="role-members-header">
                  <strong>
                    <Users size={15} color="#2563eb" />
                    <span>People in this role ({roleMembers.length})</span>
                  </strong>
                </div>
                {roleMembers.length === 0 ? (
                  <div style={{ padding: "12px 16px", background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, color: "#64748b", fontSize: 13 }}>
                    No team members assigned to this role yet. Click <strong>+ Add Employee Login</strong> above to provision credentials.
                  </div>
                ) : (
                  <div className="role-members-list">
                    {roleMembers.map((m) => (
                      <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="role-member-item">
                          <div className="role-member-info">
                            <div className="role-member-avatar">
                              {initialOf(m.displayName || m.email || "U")}
                            </div>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span className="role-member-name">
                                  {m.subject === w.subject ? `${m.displayName} (You)` : m.displayName}
                                </span>
                                {m.owner && (
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9999, background: "#f3e8ff", color: "#7e22ce", border: "1px solid #d8b4fe" }}>
                                    Owner
                                  </span>
                                )}
                                {m.active ? (
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9999, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" }}>
                                    ● Active
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9999, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
                                    Revoked
                                  </span>
                                )}
                              </div>
                              {m.email && <span className="role-member-email">{m.email}</span>}
                              {m.roleIds.length > 1 && (
                                <span style={{ fontSize: 11.5, color: "#64748b", marginLeft: 6 }}>
                                  +{m.roleIds.length - 1} other role{m.roleIds.length > 2 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>

                          {!m.owner && (
                            <div className="role-member-actions">
                              {m.active && canCreateLogins && (
                                <button
                                  type="button"
                                  className="role-member-btn"
                                  onClick={() => {
                                    setResettingMemberId(resettingMemberId === m.id ? undefined : m.id);
                                    setResetPasswordValue(makeRandomPassword());
                                  }}
                                >
                                  <KeyRound size={12} color="#2563eb" />
                                  <span>{resettingMemberId === m.id ? "Cancel" : "Credentials"}</span>
                                </button>
                              )}
                              {m.active && (
                                <button
                                  type="button"
                                  className="role-member-btn"
                                  onClick={() => {
                                    setEditingMemberId(editingMemberId === m.id ? undefined : m.id);
                                    setEditingMemberRoles(m.roleIds);
                                  }}
                                >
                                  <UserCog size={12} color="#059669" />
                                  <span>{editingMemberId === m.id ? "Cancel" : "Edit Roles"}</span>
                                </button>
                              )}
                              {m.active && (
                                <button
                                  type="button"
                                  className="role-member-btn"
                                  onClick={() => {
                                    if (window.confirm(`Remove ${m.email ?? m.displayName} from the role "${role.name}"?`)) {
                                      const newRoles = m.roleIds.filter((id) => id !== role.id);
                                      void change(`/members/${m.id}/roles`, { roleIds: newRoles }).then(() => reload());
                                    }
                                  }}
                                >
                                  <UserMinus size={12} color="#d97706" />
                                  <span>Remove</span>
                                </button>
                              )}
                              {m.active ? (
                                <button
                                  type="button"
                                  className="role-member-btn danger"
                                  onClick={() => {
                                    if (window.confirm(`Revoke access for ${m.email ?? m.displayName}?`)) {
                                      void change(`/members/${m.id}/revoke`, {}).then(() => reload());
                                    }
                                  }}
                                >
                                  Revoke
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="role-member-btn"
                                  onClick={() => void change(`/members/${m.id}/restore`, {}).then(() => reload())}
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Inline Change Credentials */}
                        {resettingMemberId === m.id && (
                          <div className="role-member-inline-form">
                            <h5>Change credentials for {m.email ?? m.displayName}</h5>
                            <p className="muted" style={{ margin: "2px 0 8px", fontSize: 12 }}>
                              Enter a new password or generate a random one. Provide it directly to the employee.
                            </p>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                type={showResetPassword ? "text" : "password"}
                                value={resetPasswordValue}
                                minLength={8}
                                onChange={(e) => setResetPasswordValue(e.target.value)}
                                placeholder="New password (min 8 chars)"
                                style={{ flex: "1 1 200px", fontFamily: "ui-monospace, monospace" }}
                              />
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setResetPasswordValue(makeRandomPassword())}
                              >
                                🎲 Random
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setShowResetPassword(!showResetPassword)}
                              >
                                {showResetPassword ? "Hide" : "Show"}
                              </button>
                              <button
                                type="button"
                                className="role-btn-primary"
                                style={{ padding: "6px 14px", fontSize: 12 }}
                                disabled={resetBusy || resetPasswordValue.length < 8}
                                onClick={() => void handleResetPassword(m, role.id)}
                              >
                                {resetBusy ? "Updating…" : "Update credentials"}
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setResettingMemberId(undefined)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Inline Edit Roles */}
                        {editingMemberId === m.id && (
                          <div className="role-member-inline-form">
                            <h5>Edit roles for {m.email ?? m.displayName}</h5>
                            <div className="console-roles" style={{ margin: "8px 0" }}>
                              {w.roles.map((r) => (
                                <label key={r.id}>
                                  <input
                                    type="checkbox"
                                    checked={editingMemberRoles.includes(r.id)}
                                    onChange={() =>
                                      setEditingMemberRoles(
                                        editingMemberRoles.includes(r.id)
                                          ? editingMemberRoles.filter((id) => id !== r.id)
                                          : [...editingMemberRoles, r.id]
                                      )
                                    }
                                  />
                                  {r.name}
                                </label>
                              ))}
                            </div>
                            <div className="csv-actions" style={{ marginTop: 4 }}>
                              <button
                                type="button"
                                className="role-btn-primary"
                                style={{ padding: "6px 14px", fontSize: 12 }}
                                onClick={() => void (async () => {
                                  const ok = await change(`/members/${m.id}/roles`, { roleIds: editingMemberRoles });
                                  if (ok) {
                                    setEditingMemberId(undefined);
                                    await reload();
                                  }
                                })()}
                              >
                                Save roles
                              </button>
                              <button type="button" className="secondary" onClick={() => setEditingMemberId(undefined)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isOpen && editing && (
                <RoleEditor
                  w={w}
                  change={change}
                  value={editing}
                  onChange={setEditing}
                  onClose={() => setEditing(undefined)}
                  tenant={tenant}
                  onRoleCreated={async (roleId, _name, issued) => {
                    if (issued) {
                      setIssuedForRole({ roleId, set: issued });
                    }
                    await reload();
                  }}
                />
              )}
            </section>
          );
        })}
      </div>
      {w.roles.length === 0 && !editing && <p className="muted">No roles yet. Create one to start giving people access.</p>}
    </div>
  );
}

function RoleEditor({
  w,
  change: _change,
  value,
  onChange,
  onClose,
  tenant,
  onRoleCreated,
}: {
  w: SaasWorkspace;
  change: Change;
  value: Editing;
  onChange: (v: Editing) => void;
  onClose: () => void;
  tenant: string;
  onRoleCreated?: (roleId: string, roleName: string, issued?: IssuedSet) => void;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  // OTP Validation State for Role Creation
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSentTo, setOtpSentTo] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpRequesting, setOtpRequesting] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(600);
  const [cooldown, setCooldown] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");

  // Optional team member provisioning with temporary credentials when creating a role
  const [provisionPerson, setProvisionPerson] = useState(true);
  const [personName, setPersonName] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [personPassword, setPersonPassword] = useState(() => makeRandomPassword());
  const [showPersonPassword, setShowPersonPassword] = useState(false);
  const [personError, setPersonError] = useState("");

  const active = useMemo(() => w.kpis.filter((k) => k.state === "active"), [w.kpis]);
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const map = new Map<string, typeof active>();
    for (const k of active) {
      if (needle && !`${k.name} ${k.description}`.toLowerCase().includes(needle)) continue;
      const key = k.domain ?? "";
      map.set(key, [...(map.get(key) ?? []), k]);
    }
    return [...map.entries()].sort(([a], [b]) => domainTitle(a || null).localeCompare(domainTitle(b || null)));
  }, [active, search]);
  const set = (patch: Partial<Editing>) => onChange({ ...value, ...patch });
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const usesKpis = value.capabilities.includes("view") || value.capabilities.includes("act") || value.capabilities.includes("submit");
  const usesScope = value.capabilities.some((c) => c !== "configure");
  const chosen = new Set(value.kpiIds);

  // Timer countdowns
  useEffect(() => {
    if (!otpModalOpen) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [otpModalOpen]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [cooldown]);

  async function requestRoleOtp() {
    setOtpRequesting(true);
    setOtpError("");
    try {
      const res = await request(
        `/api/saas/${tenant}/roles/request-otp`,
        RequestRoleOtpResponseSchema,
        { roleName: value.name.trim() }
      );
      setOtpSentTo(res.sentTo);
      setSecondsLeft(res.expiresInMinutes * 60);
      setCooldown(30);
      if (res.debugCode) {
        setOtpCode(res.debugCode);
      }
      return true;
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Unable to generate verification code.");
      return false;
    } finally {
      setOtpRequesting(false);
    }
  }

  async function handleStartSave() {
    if (problem) return;
    if (!value.roleId && provisionPerson && !personEmail.trim()) {
      setPersonError("Please enter the employee work email, or uncheck 'Assign Now'.");
      return;
    }
    // When creating a new role (or saving as owner), prompt for OTP verification!
    setOtpModalOpen(true);
    setOtpCode("");
    setOtpError("");
    setSuccessMessage("");
    await requestRoleOtp();
  }

  async function handleVerifyAndCreateRole() {
    if (otpCode.trim().length !== 6) {
      setOtpError("Please enter the complete 6-digit OTP code.");
      return;
    }
    setOtpVerifying(true);
    setOtpError("");
    try {
      const saveRes = await request(
        `/api/saas/${tenant}/roles/save`,
        z.object({ id: z.string() }),
        {
          ...(value.roleId ? { roleId: value.roleId } : {}),
          name: value.name.trim(),
          capabilities: value.capabilities,
          scopeUnitId: usesScope ? value.scopeUnitId : null,
          kpiIds: usesKpis && !value.allKpis ? value.kpiIds : [],
          otpCode: otpCode.trim(),
        }
      );
      const roleId = saveRes.id;
      let issuedSet: IssuedSet | undefined;

      if (!value.roleId && provisionPerson && personEmail.trim()) {
        try {
          const peopleResult = await request(
            `/api/identity/organizations/${tenant}/people`,
            InviteMembersResponseSchema,
            {
              members: [{
                displayName: personName.trim() || personEmail.trim().split('@')[0],
                email: personEmail.trim(),
                roleIds: [roleId],
                password: personPassword.trim() || undefined,
              }],
            }
          );
          issuedSet = {
            title: `Credentials created for ${value.name.trim()}`,
            mode: peopleResult.mode,
            people: peopleResult.members,
          };
        } catch (e) {
          console.error("Failed to provision initial employee credentials:", e);
        }
      }

      setSuccessMessage(`✓ Role "${value.name.trim()}" authorized and created successfully!`);
      setTimeout(() => {
        setOtpModalOpen(false);
        onRoleCreated?.(roleId, value.name.trim(), issuedSet);
        onClose();
      }, 700);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Failed to verify OTP.");
    } finally {
      setOtpVerifying(false);
    }
  }

  async function directSaveWithoutOtp() {
    setBusy(true);
    try {
      const saveRes = await request(
        `/api/saas/${tenant}/roles/save`,
        z.object({ id: z.string() }),
        {
          ...(value.roleId ? { roleId: value.roleId } : {}),
          name: value.name.trim(),
          capabilities: value.capabilities,
          scopeUnitId: usesScope ? value.scopeUnitId : null,
          kpiIds: usesKpis && !value.allKpis ? value.kpiIds : [],
        }
      );
      const roleId = saveRes.id;
      let issuedSet: IssuedSet | undefined;

      if (!value.roleId && provisionPerson && personEmail.trim()) {
        try {
          const peopleResult = await request(
            `/api/identity/organizations/${tenant}/people`,
            InviteMembersResponseSchema,
            {
              members: [{
                displayName: personName.trim() || personEmail.trim().split('@')[0],
                email: personEmail.trim(),
                roleIds: [roleId],
                password: personPassword.trim() || undefined,
              }],
            }
          );
          issuedSet = {
            title: `Credentials created for ${value.name.trim()}`,
            mode: peopleResult.mode,
            people: peopleResult.members,
          };
        } catch (e) {
          console.error("Failed to provision initial employee credentials:", e);
        }
      }

      onRoleCreated?.(roleId, value.name.trim(), issuedSet);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save role.");
    } finally {
      setBusy(false);
    }
  }

  const problem =
    !value.name.trim()
      ? "Give the role a name."
      : value.capabilities.length === 0
        ? "Choose at least one thing this role can do."
        : usesKpis && !value.allKpis && value.kpiIds.length === 0
          ? "Choose the KPIs this role can access, or choose every KPI."
          : "";

  return (
    <div className="role-editor">
      {value.custom && (
        <p className="warn">
          This role was set up with permissions these controls cannot show exactly (for example from a template). What you see is the closest match. Saving replaces its permissions with exactly what is chosen here.
        </p>
      )}
      <label>
        Role name
        <input value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="For example: Branch manager" />
      </label>

      <fieldset className="cap-grid">
        <legend>What this role can do</legend>
        {CAPABILITIES.map((c) => (
          <label key={c.key} className="cap-option">
            <input type="checkbox" aria-label={c.label} checked={value.capabilities.includes(c.key)} onChange={() => set({ capabilities: toggle(value.capabilities, c.key) })} />
            <span>
              <strong>{c.label}</strong>
              <small className="muted">{c.help}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {usesScope && (
        <label>
          Where
          <select value={value.scopeUnitId ?? ""} onChange={(e) => set({ scopeUnitId: e.target.value || null })}>
            <option value="">The whole organization</option>
            {w.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} and everything under it
              </option>
            ))}
          </select>
        </label>
      )}

      {usesKpis && (
        <fieldset className="kpi-pick">
          <legend>Which KPIs this role can see or update</legend>
          <div className="console-roles">
            <label>
              <input type="radio" name="kpi-mode" checked={value.allKpis} onChange={() => set({ allKpis: true })} />
              Every KPI, including ones added later
            </label>
            <label>
              <input type="radio" name="kpi-mode" checked={!value.allKpis} onChange={() => set({ allKpis: false })} />
              Only the KPIs I choose ({value.kpiIds.length} chosen)
            </label>
          </div>
          {!value.allKpis && (
            <>
              <div className="csv-actions">
                <input type="search" aria-label="Search KPIs" placeholder="Search KPIs" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
                <button type="button" className="secondary" onClick={() => set({ kpiIds: [] })}>Clear</button>
              </div>
              <div className="kpi-groups">
                {groups.map(([domain, list]) => {
                  const all = list.every((k) => chosen.has(k.id));
                  return (
                    <div key={domain} className="kpi-group">
                      <label className="kpi-group-title">
                        <input
                          type="checkbox"
                          checked={all}
                          onChange={() =>
                            set({
                              kpiIds: all
                                ? value.kpiIds.filter((id) => !list.some((k) => k.id === id))
                                : [...new Set([...value.kpiIds, ...list.map((k) => k.id)])],
                            })
                          }
                        />
                        <strong>{domainTitle(domain || null)}</strong>
                        <small className="muted">{list.filter((k) => chosen.has(k.id)).length} of {list.length}</small>
                      </label>
                      {list.map((k) => (
                        <label key={k.id} className="kpi-item">
                          <input type="checkbox" checked={chosen.has(k.id)} onChange={() => set({ kpiIds: toggle(value.kpiIds, k.id) })} />
                          {k.name}
                        </label>
                      ))}
                    </div>
                  );
                })}
                {groups.length === 0 && <p className="muted">No KPI matches that search.</p>}
              </div>
            </>
          )}
        </fieldset>
      )}

      {/* When creating a new role: Option to provision team member with temporary credentials */}
      {!value.roleId && (
        <div style={{ marginTop: 22, padding: "18px 20px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "#dbeafe", color: "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <UserPlus size={18} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "#0f172a" }}>
                  Assign Team Member &amp; Issue Temporary Credentials
                </h4>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                  Assign an employee to this role now and generate their initial sign-in credentials.
                </p>
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#1d4ed8" }}>
              <input
                type="checkbox"
                checked={provisionPerson}
                onChange={(e) => setProvisionPerson(e.target.checked)}
                style={{ width: 15, height: 15 }}
              />
              <span>Assign Now</span>
            </label>
          </div>

          {provisionPerson && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#475569", marginBottom: 5 }}>
                    Employee Full Name
                  </label>
                  <input
                    type="text"
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                    placeholder="e.g. Dr. Priya Patel"
                    maxLength={120}
                    style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#475569", marginBottom: 5 }}>
                    Employee Work Email *
                  </label>
                  <input
                    type="email"
                    value={personEmail}
                    onChange={(e) => {
                      setPersonEmail(e.target.value);
                      if (personError) setPersonError("");
                    }}
                    placeholder="e.g. priya.patel@hospital.demo"
                    style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: personError ? "1px solid #ef4444" : "1px solid #cbd5e1", fontSize: 13 }}
                  />
                </div>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#475569" }}>
                    Temporary Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setPersonPassword(makeRandomPassword())}
                    style={{ background: "none", border: "none", color: "#2563eb", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <RefreshCw size={11} />
                    <span>Generate New</span>
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPersonPassword ? "text" : "password"}
                    value={personPassword}
                    onChange={(e) => setPersonPassword(e.target.value)}
                    placeholder="Temporary password"
                    style={{ width: "100%", padding: "8px 36px 8px 11px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontFamily: "monospace" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPersonPassword(!showPersonPassword)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
                  >
                    {showPersonPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {personError && (
                <div style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>
                  {personError}
                </div>
              )}

              <div style={{ padding: "8px 12px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe", fontSize: 12, color: "#1e40af" }}>
                ℹ️ When this role is authorized, this team member will be created with these temporary credentials. You will be able to copy the credentials to provide directly to them.
              </div>
            </div>
          )}
        </div>
      )}

      {problem && <p className="muted">{problem}</p>}
      <div className="csv-actions">
        <button
          type="button"
          disabled={busy || otpRequesting || !!problem}
          onClick={() => {
            if (!value.roleId) {
              void handleStartSave();
            } else {
              void directSaveWithoutOtp();
            }
          }}
        >
          {busy || otpRequesting ? "Initializing…" : value.roleId ? "Save role" : "🔐 Create role with OTP"}
        </button>
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      </div>

      {/* Role Creation OTP Validation Modal */}
      {otpModalOpen && (
        <div className="role-otp-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setOtpModalOpen(false); }}>
          <dialog open className="role-otp-modal" aria-labelledby="role-otp-modal-title">
            <div className="role-otp-header">
              <div className="role-otp-shield" aria-hidden="true">🛡️</div>
              <div className="role-otp-title-group">
                <h3 id="role-otp-modal-title">Authorize Role Creation</h3>
                <p>An owner security code is required to create <strong>&ldquo;{value.name.trim()}&rdquo;</strong>.</p>
              </div>
            </div>

            <div className="role-otp-notice">
              <span>✉️</span>
              <span>
                A 6-digit one-time password (OTP) was issued to: <strong>{otpSentTo || "registered organization owner"}</strong>.
              </span>
            </div>


            <div className="role-otp-input-box">
              <label htmlFor="role-otp-field" style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                Enter 6-Digit Verification Code
              </label>
              <input
                id="role-otp-field"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                className="role-otp-input"
                value={otpCode}
                onChange={(e) => {
                  const clean = e.target.value.replace(/\D/g, "");
                  setOtpCode(clean);
                  if (clean.length === 6) setOtpError("");
                }}
                placeholder="······"
              />
              <div className={`role-otp-timer ${secondsLeft < 120 ? "expiring" : ""}`}>
                ⏱️ Code valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </div>
            </div>

            {otpError && (
              <p role="alert" className="errors" style={{ textAlign: "center", margin: 0 }}>
                {otpError}
              </p>
            )}

            {successMessage && (
              <div style={{ background: "#f0fdf4", color: "#166534", padding: "10px", borderRadius: 8, textAlign: "center", fontWeight: 600, fontSize: 13 }}>
                {successMessage}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <button
                type="button"
                className="secondary"
                disabled={cooldown > 0 || otpRequesting}
                onClick={() => void requestRoleOtp()}
                style={{ fontSize: 12, padding: "6px 10px" }}
              >
                {otpRequesting ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "↻ Resend code"}
              </button>
              <div className="role-otp-actions" style={{ margin: 0 }}>
                <button type="button" className="secondary" onClick={() => setOtpModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={otpCode.length !== 6 || otpVerifying || !!successMessage}
                  onClick={() => void handleVerifyAndCreateRole()}
                  style={{ minWidth: 160 }}
                >
                  {otpVerifying ? "Verifying OTP…" : "Verify & Create"}
                </button>
              </div>
            </div>
          </dialog>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function People({ w, change, tenant, reload }: { w: SaasWorkspace; change: Change; tenant: string; reload: () => Promise<void> }) {
  const [editingId, setEditingId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [inviteRoles, setInviteRoles] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [emailsText, setEmailsText] = useState("");
  const [loginRoles, setLoginRoles] = useState<string[]>([]);
  const [issued, setIssued] = useState<IssuedSet>();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const canCreateLogins = true;
  const parsed = useMemo(() => parseEmails(emailsText), [emailsText]);
  async function resetPassword(member: SaasWorkspace["members"][number]) {
    const who = member.email ?? member.displayName;
    if (!window.confirm(`Give ${who} a new temporary password? Their current password stops working.`)) return;
    setLoginMessage("");
    setIssued(undefined);
    try {
      const result = await request(`/api/identity/organizations/${tenant}/members/${member.id}/reset-password`, ResetPasswordResponseSchema, {});
      setIssued({ title: `New temporary password for ${who}`, mode: "logins", people: [{ email: who, roleKeys: member.roleIds, temporaryPassword: result.temporaryPassword }] });
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "That did not work.");
    }
  }
  const roleName = new Map(w.roles.map((r) => [r.id, r.name]));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const sorted = [...w.members].sort((a, b) => Number(b.owner) - Number(a.owner) || Number(b.active) - Number(a.active) || (a.email ?? a.displayName).localeCompare(b.email ?? b.displayName));

  return (
    <>
      <section className="saas-card">
        <h2>People</h2>
        <div className="saas-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Roles</th>
                <th>Status</th>
                <th><span className="sr-only">Manage</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.subject === w.subject ? "You" : m.displayName}</strong>
                    {m.email && <small>{m.email}</small>}
                  </td>
                  <td>
                    {m.owner ? (
                      <span className="saas-badge good">Owner: everything</span>
                    ) : editingId === m.id ? (
                      <div className="console-roles">
                        {w.roles.map((r) => (
                          <label key={r.id}>
                            <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => setRoleIds(toggle(roleIds, r.id))} />
                            {r.name}
                          </label>
                        ))}
                      </div>
                    ) : m.roleIds.length ? (
                      <div className="chip-row">
                        {m.roleIds.map((id) => (
                          <span key={id} className="saas-badge">{roleName.get(id) ?? "Role"}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="saas-badge bad">No role: sees nothing</span>
                    )}
                  </td>
                  <td>{m.active ? "Active" : "Access revoked"}</td>
                  <td>
                    {!m.owner && editingId === m.id && (
                      <div className="csv-actions" style={{ marginTop: 0 }}>
                        <button
                          type="button"
                          onClick={() =>
                            void change(`/members/${m.id}/roles`, { roleIds }).then((ok) => ok && setEditingId(""))
                          }
                        >
                          Save roles
                        </button>
                        <button type="button" className="secondary" onClick={() => setEditingId("")}>Cancel</button>
                      </div>
                    )}
                    {!m.owner && editingId !== m.id && (
                      <div className="csv-actions" style={{ marginTop: 0 }}>
                        {m.active && (
                          <button type="button" className="secondary" onClick={() => { setEditingId(m.id); setRoleIds(m.roleIds); }}>
                            Change roles
                          </button>
                        )}
                        {m.active && canCreateLogins && (
                          <button type="button" className="secondary" onClick={() => void resetPassword(m)}>
                            Reset password
                          </button>
                        )}
                        {m.active ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              if (window.confirm(`Revoke access for ${m.email ?? m.displayName}? They keep their roles and can be restored.`))
                                void change(`/members/${m.id}/revoke`, {});
                            }}
                          >
                            Revoke access
                          </button>
                        ) : (
                          <button type="button" className="secondary" onClick={() => void change(`/members/${m.id}/restore`, {})}>
                            Restore access
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loginMessage && <p role="alert" className="errors">{loginMessage}</p>}
        {issued && <AccessPanel set={issued} roleName={(key) => roleName.get(key) ?? key} />}
      </section>

      {canCreateLogins && (
        <section className="saas-card">
          <h2>Add people with a login</h2>
          <p className="muted">
            Each person gets an email and a temporary password, shown to you once. They sign in, choose their own password, and see only what their roles allow.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (parsed.errors.length || parsed.emails.length === 0 || loginRoles.length === 0) return;
              setLoginBusy(true);
              setLoginMessage("");
              setIssued(undefined);
              request(`/api/identity/organizations/${tenant}/people`, InviteMembersResponseSchema, {
                members: parsed.emails.map((address) => ({ email: address, roleIds: loginRoles })),
              })
                .then(async (result) => {
                  setIssued({ title: result.members.length === 1 ? "Person added" : "People added", mode: result.mode, people: result.members });
                  setEmailsText("");
                  setLoginRoles([]);
                  await reload();
                })
                .catch((error) => setLoginMessage(error instanceof Error ? error.message : "That did not work."))
                .finally(() => setLoginBusy(false));
            }}
          >
            <label>
              Work emails, one per line
              <textarea value={emailsText} onChange={(e) => setEmailsText(e.target.value)} rows={4} placeholder={"anita@acme.com\nravi@acme.com"} />
            </label>
            <fieldset className="kpi-pick">
              <legend className="muted">They all get these roles</legend>
              <div className="console-roles">
                {w.roles.map((r) => (
                  <label key={r.id}>
                    <input type="checkbox" checked={loginRoles.includes(r.id)} onChange={() => setLoginRoles(toggle(loginRoles, r.id))} />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {parsed.errors.length > 0 && (
              <ul className="errors">
                {parsed.errors.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <button disabled={loginBusy || parsed.emails.length === 0 || parsed.errors.length > 0 || loginRoles.length === 0}>
              {loginBusy ? "Creating…" : `Create ${parsed.emails.length || ""} login${parsed.emails.length === 1 ? "" : "s"}`.replace("  ", " ")}
            </button>
          </form>
        </section>
      )}

      <section className="saas-card">
        <h2>Add a person & send invitation email</h2>
        <p className="muted">
          Enter their work email and assign their roles. A secure email will be sent directly to that address with an option to set their password. Their email serves as their permanent Login ID.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const targetEmail = email.trim();
            void change("/invitations", { email: targetEmail, roleIds: inviteRoles }).then((ok) => {
              if (ok) {
                setEmail("");
                setInviteRoles([]);
              }
            });
          }}
        >
          <label>
            Work email (will receive password setup email & serves as Login ID)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
            />
          </label>
          <fieldset className="kpi-pick" style={{ border: "none", padding: 0, margin: "14px 0" }}>
            <legend className="muted" style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Assign Roles</legend>
            <div className="console-roles">
              {w.roles.map((r) => (
                <label key={r.id}>
                  <input type="checkbox" checked={inviteRoles.includes(r.id)} onChange={() => setInviteRoles(toggle(inviteRoles, r.id))} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={!email.trim() || inviteRoles.length === 0} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span>✉</span>
            <span>Send invitation & password setup email</span>
          </button>
        </form>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function Units({ w, change }: { w: SaasWorkspace; change: Change }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const root = w.units.find((u) => u.parentId === null);
  const [parentId, setParentId] = useState(root?.id ?? "");
  const [renaming, setRenaming] = useState<{ id: string; name: string; kind: string }>();
  const tree = useMemo(() => {
    const out: { id: string; name: string; kind: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const u of w.units.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ id: u.id, name: u.name, kind: u.kind, depth });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [w.units]);

  return (
    <div className="saas-columns">
      <section className="saas-card">
        <h2>Structure</h2>
        <p className="muted">Figures are reported per unit. A unit's results add up the units under it.</p>
        <ul className="unit-tree">
          {tree.map((u) => (
            <li key={u.id} style={{ paddingLeft: u.depth * 22 }}>
              {renaming?.id === u.id ? (
                <span className="unit-edit">
                  <input aria-label="Unit name" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={120} />
                  <input aria-label="Unit type" value={renaming.kind} onChange={(e) => setRenaming({ ...renaming, kind: e.target.value })} maxLength={60} />
                  <button
                    type="button"
                    disabled={!renaming.name.trim() || !renaming.kind.trim()}
                    onClick={() => void change(`/units/${u.id}/rename`, { name: renaming.name.trim(), kind: renaming.kind.trim() }).then((ok) => ok && setRenaming(undefined))}
                  >
                    Save
                  </button>
                  <button type="button" className="secondary" onClick={() => setRenaming(undefined)}>Cancel</button>
                </span>
              ) : (
                <span className="unit-row">
                  <span>
                    <strong>{u.name}</strong> <small className="muted">{u.kind}</small>
                  </span>
                  <span className="unit-actions">
                    <button type="button" className="secondary" onClick={() => setRenaming({ id: u.id, name: u.name, kind: u.kind })}>Rename</button>
                    {u.depth > 0 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (window.confirm(`Delete the unit “${u.name}”? This is only possible while nothing depends on it.`))
                            void change(`/units/${u.id}/delete`, {});
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="saas-card">
        <h2>Add a unit</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void change("/units", { name: name.trim(), kind: kind.trim(), parentId: parentId || null }).then((ok) => {
              if (ok) {
                setName("");
                setKind("");
              }
            });
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="For example: Pune branch" />
          </label>
          <label>
            Type
            <input value={kind} onChange={(e) => setKind(e.target.value)} required maxLength={60} placeholder="Branch, site, department…" />
          </label>
          <label>
            Under
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              {tree.map((u) => (
                <option key={u.id} value={u.id}>
                  {"— ".repeat(u.depth)}
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!name.trim() || !kind.trim()}>Add unit</button>
        </form>
      </section>
    </div>
  );
}
