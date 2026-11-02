import { useState } from "react";
import {
  data,
  Form,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  AuthConfigurationError,
  getAuthClient,
  getCurrentSession,
  signInWithPassword,
} from "../../lib/auth";
import { mustChangePassword } from "./change-password-route";
import "./login.css";

interface LoginFieldErrors {
  email?: string;
  password?: string;
}

interface LoginActionData {
  email?: string;
  errors?: LoginFieldErrors;
  message?: string;
}

interface LoginInput {
  email: string;
  password: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The fictional demo organization's sign-in domain (DEMO_RUNBOOK.md). A short
 * sign-in ID such as `hospital` or `admin` is completed with it, so the demo
 * accounts can be typed quickly. This only builds the email address: Supabase
 * Auth still checks the password, and the API still derives role and scope from
 * the verified membership. Not a secret.
 */
export const DEMO_SIGN_IN_DOMAIN = "kestrion.demo";


/** An email stays as typed; a short sign-in ID becomes an address on the demo domain. */
export function signInEmail(value: string) {
  return value;
}

export function getSafeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  const parsed = new URL(value, "https://orbit.invalid");

  if (parsed.origin !== "https://orbit.invalid" || parsed.pathname === "/login") {
    return "/";
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function validateLoginInput(formData: FormData):
  | { input: LoginInput; errors?: never }
  | { input?: never; errors: LoginFieldErrors; email: string } {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const rawTyped = typeof emailValue === "string" ? emailValue.trim() : "";
  const typed = rawTyped.includes("@") ? rawTyped.replace(/\s+/g, "") : rawTyped;
  const email = signInEmail(typed);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const errors: LoginFieldErrors = {};

  if (!typed) {
    errors.email = "Enter your work email.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid work email.";
  }

  if (!password) {
    errors.password = "Enter your password.";
  }

  if (Object.keys(errors).length > 0) {
    return { email: typed, errors };
  }

  return { input: { email, password } };
}

export async function loginLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const isResetSuccess = url.searchParams.get("reset") === "success";
  const returnTo = getSafeReturnPath(url.searchParams.get("returnTo"));

  try {
    if (isResetSuccess) {
      try {
        const client = await getAuthClient();
        await client.auth.signOut();
      } catch {
        // ignore
      }
      return null;
    }

    const session = await getCurrentSession();

    if (session) {
      return redirect(returnTo);
    }
  } catch (error: unknown) {
    if (!(error instanceof AuthConfigurationError)) {
      throw error;
    }
  }

  return null;
}

export async function loginAction({ request }: ActionFunctionArgs) {
  const validation = validateLoginInput(await request.formData());

  if (validation.errors) {
    return data<LoginActionData>(
      { email: validation.email, errors: validation.errors },
      { status: 400 },
    );
  }

  try {
    const result = await signInWithPassword(
      validation.input.email,
      validation.input.password,
    );

    if (!result.ok) {
      const message =
        result.message ||
        (result.reason === "invalid_credentials"
          ? "We couldn't sign you in with those credentials. Check your email and password."
          : "The sign-in service is unavailable right now. Please try again shortly.");

      return data<LoginActionData>(
        { email: validation.input.email, message },
        { status: result.reason === "invalid_credentials" ? 401 : 503 },
      );
    }
  } catch (error: unknown) {
    if (!(error instanceof AuthConfigurationError)) {
      throw error;
    }

    return data<LoginActionData>(
      {
        email: validation.input.email,
        message: "Sign-in is not configured in this environment yet.",
      },
      { status: 503 },
    );
  }

  const session = await getCurrentSession();
  if (mustChangePassword(session?.user)) {
    return redirect("/change-password");
  }

  const returnTo = getSafeReturnPath(new URL(request.url).searchParams.get("returnTo"));
  return redirect(returnTo);
}

import {
  Building2,
  Lock,
  Mail,
  Eye,
  EyeOff,
  Shield,
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { ForgotPasswordModal } from "./forgot-password-modal";

export function LoginRoute() {
  const [searchParams] = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";
  const emailParam = searchParams.get("email") ?? "";
  const actionData = useActionData<LoginActionData>();
  const navigation = useNavigation();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [email, setEmail] = useState(actionData?.email ?? emailParam);
  const [password, setPassword] = useState("");
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotSuccessMessage, setForgotSuccessMessage] = useState("");
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen flex bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif" }}>
      {/* ─── Left Panel — Executive Command Center Branding ─── */}
      <div
        className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col relative overflow-hidden border-r border-slate-200"
        style={{
          background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 45%, #eff6ff 100%)",
        }}
      >
        {/* Subtle grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(rgba(148,163,184,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.4) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />

        {/* Glowing radial gradient orbs */}
        <div
          className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20 pointer-events-none"
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-80 h-80 rounded-full opacity-15 pointer-events-none"
          style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 70%)" }}
        />

        {/* Branding Content */}
        <div className="relative z-10 flex flex-col h-full p-12 xl:p-16">
          {/* Logo Header */}
          <div className="flex items-center gap-3 mb-auto">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20"
              style={{ background: "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)" }}
            >
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <span className="text-slate-900 font-extrabold text-lg tracking-tight">Executive</span>
              <span className="text-blue-600 text-sm font-semibold ml-1.5 uppercase tracking-wider">Command Center</span>
            </div>
          </div>

          {/* Main Headline */}
          <div className="my-auto max-w-lg">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 border"
              style={{
                background: "#eff6ff",
                borderColor: "#bfdbfe",
              }}
            >
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              <span className="text-blue-700 text-xs font-bold tracking-wider uppercase">
                Performance Telemetry & Decision Queue
              </span>
            </div>

            <h1 className="text-4xl xl:text-5xl font-black text-slate-900 leading-tight mb-5 tracking-tight">
              Decisions start with{" "}
              <span
                style={{
                  background: "linear-gradient(90deg, #60a5fa, #38bdf8)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                clarity.
              </span>
            </h1>

            <p className="text-slate-600 text-base xl:text-lg leading-relaxed mb-8">
              Turn authorized operational evidence into focused executive decisions and accountable actions across your entire organization.
            </p>

            {/* Core Capability Badges */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { step: "01", label: "Triage Exceptions", desc: "Automated telemetry & morning brief" },
                { step: "02", label: "Verify Evidence", desc: "Transparent calculation audits" },
                { step: "03", label: "Authorise Actions", desc: "Executive sign-off & memos" },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-xl p-3.5 border"
                  style={{
                    background: "#ffffff",
                    borderColor: "#e2e8f0",
                  }}
                >
                  <span className="text-xs font-mono font-bold text-blue-600">{item.step}</span>
                  <div className="text-sm font-bold text-slate-900 mt-1">{item.label}</div>
                  <div className="text-slate-500 text-[11px] mt-0.5 leading-tight">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer security notice */}
          <div className="flex items-center gap-2 mt-auto">
            <Shield size={15} className="text-slate-500" />
            <span className="text-slate-500 text-xs">
              Multi-tenant workspace · Role-scoped access and auditable changes
            </span>
          </div>
        </div>
      </div>

      {/* ─── Right Panel — Executive Login Form ─── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
              style={{ background: "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)" }}
            >
              <Building2 size={20} className="text-white" />
            </div>
            <div>
              <span className="text-slate-900 font-extrabold text-lg tracking-tight">Executive</span>
              <span className="text-blue-600 text-sm font-semibold ml-1.5 uppercase">Command Center</span>
            </div>
          </div>

          <header className="mb-8">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2.5 py-1 rounded">
              Secure Sign In
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-3">
              Sign in to your workspace
            </h2>
            <p className="text-sm text-slate-500 mt-1.5">
              Enter the work account provisioned for your authorized role and scope.
            </p>
          </header>

          {/* Password Reset Success Notice */}
          {(resetSuccess || forgotSuccessMessage) && (
            <output
              className="block mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3 shadow-xs animate-in fade-in"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-emerald-900">
                  Password Updated Successfully
                </div>
                <div className="text-xs text-emerald-700 leading-relaxed">
                  {forgotSuccessMessage || "Your password has been changed. Please sign in with your new credentials to continue."}
                </div>
              </div>
            </output>
          )}

          {/* Error Alert */}
          {actionData?.message && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 animate-in fade-in"
            >
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs font-medium leading-relaxed">{actionData.message}</div>
            </div>
          )}

          <Form method="post" noValidate className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5"
              >
                Work Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.org"
                  required
                  spellCheck={false}
                  autoCapitalize="none"
                  inputMode="email"
                  className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all focus:outline-none ${
                    actionData?.errors?.email
                      ? "border-rose-300 bg-rose-50/30 text-rose-900 focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
                      : "border-slate-300 bg-white text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  }`}
                />
              </div>
              {actionData?.errors?.email && (
                <p className="text-xs text-rose-600 font-semibold mt-1.5 ml-1">
                  {actionData.errors.email}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-700"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotSuccessMessage("");
                    setForgotPasswordOpen(true);
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className={`w-full pl-10 pr-10 py-2.5 rounded-xl border text-sm font-medium transition-all focus:outline-none ${
                    actionData?.errors?.password
                      ? "border-rose-300 bg-rose-50/30 text-rose-900 focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
                      : "border-slate-300 bg-white text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                >
                  {passwordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {actionData?.errors?.password && (
                <p className="text-xs text-rose-600 font-semibold mt-1.5 ml-1">
                  {actionData.errors.password}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-3 px-4 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </Form>

          {/* Quick Demo & Provisioned Credentials Helper */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Quick Sign-In Credentials
              </span>
              <span className="text-[11px] font-semibold text-blue-600">Click to fill</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              <button
                type="button"
                onClick={() => {
                  setEmail("ghanshamrn.a27@gmail.com");
                  setPassword("Ghansham@123");
                }}
                className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-blue-50/70 hover:border-blue-300 text-left transition-colors cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 flex items-center justify-between">
                  <span>Platform Operator</span>
                  <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">Operator</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">ghanshamrn.a27@gmail.com</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Pwd: Ghansham@123</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmail("owner@kestrion.demo");
                  setPassword("Password@123");
                }}
                className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50/70 hover:border-emerald-300 text-left transition-colors cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 flex items-center justify-between">
                  <span>Healthcare Org Admin</span>
                  <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-mono">Admin</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">owner@kestrion.demo</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Pwd: Password@123</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmail("beingsocial@gmail.com");
                  setPassword("ghansham@123");
                }}
                className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50/70 hover:border-indigo-300 text-left transition-colors cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 flex items-center justify-between">
                  <span>Corporate Org Admin</span>
                  <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono">Admin</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">beingsocial@gmail.com</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Pwd: ghansham@123</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmail("pooja.s@beingsocial.demo");
                  setPassword("sham@123");
                }}
                className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-purple-50/70 hover:border-purple-300 text-left transition-colors cursor-pointer"
              >
                <div className="text-[11px] font-bold text-slate-900 flex items-center justify-between">
                  <span>Staff / Clinical Lead</span>
                  <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-mono">Member</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">pooja.s@beingsocial.demo</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Pwd: sham@123</div>
              </button>
            </div>
          </div>

          {/* Workspace info & governance footer */}
          <div className="mt-8 pt-6 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Multi-tenant organization authorization enabled</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Need access? Contact your workspace administrator to provision your authorized role and scope.
            </p>
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        isOpen={forgotPasswordOpen}
        onClose={() => setForgotPasswordOpen(false)}
        initialEmail={email}
        onSuccess={(userEmail, msg) => {
          setEmail(userEmail);
          setForgotSuccessMessage(msg);
          setPassword("");
        }}
      />
    </div>
  );
}
