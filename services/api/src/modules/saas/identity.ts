import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomInt, randomUUID } from "node:crypto";
import {
  AddLoginsRequestSchema,
  ChangeOwnPasswordRequestSchema,
  ConfirmPasswordResetRequestSchema,
  ConfirmPasswordResetResponseSchema,
  InviteMembersResponseSchema,
  PasswordCodeResponseSchema,
  RequestPasswordResetOtpRequestSchema,
  RequestPasswordResetOtpResponseSchema,
  ResetPasswordRequestSchema,
  SendInviteMailRequestSchema,
  SendInviteMailResponseSchema,
  VerifyPasswordResetOtpRequestSchema,
  VerifyPasswordResetOtpResponseSchema,
} from "@orbit/contracts";
import { verifyAccessTokenClaims } from "../../plugins/auth.ts";
import { ApiError } from "../../plugins/errors.ts";
import { hash, input, inSubject, makeRunners, uuid, type SaasOptions } from "./helpers.ts";
import { maskEmail } from "./mail.ts";
import { prepareLogins } from "./logins.ts";
import { temporaryPassword } from "./auth-admin.ts";
import { runQuery, hashPassword } from "./mysql-auth.ts";

interface PasswordResetRecord {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  resetToken?: string;
}

// In-memory email-scoped OTP records for forgot-password verification
const passwordResetOtps = new Map<string, PasswordResetRecord>();

/**
 * The identity API: an organization's owner creates logins for the people they add.
 *
 * It exists as its own process because creating a login needs Supabase's secret
 * key, which must never sit in the customer API. This process holds the key and a
 * database login that can do two things only: ask whether someone owns an
 * organization, and add people to it. It cannot read the organization's data.
 */
export async function registerIdentityRoutes(app: FastifyInstance, options: SaasOptions): Promise<void> {
  const { subject } = makeRunners(options);

  app.post("/api/identity/organizations/:tenantId/people", async (req) => {
    const { tenantId } = input(z.object({ tenantId: uuid }), req.params);
    const body = input(AddLoginsRequestSchema, req.body);
    if (!options.authAdmin) throw new ApiError("unavailable", "Creating logins is not set up on this deployment.");
    const sub = await subject(req);
    const as = "kpi_identity_app" as const;

    // 1. Prove the caller owns this organization BEFORE anything is created. Creating
    //    a login uses the secret key, so nobody else may cause it to be used.
    await inSubject(
      options.identityDatabase,
      sub,
      async (tx) => {
        const [row] = await tx.query("select kpi.is_owner($1::uuid) as allowed", [tenantId]);
        if (row?.allowed !== true) throw new ApiError("forbidden", "Only the organization's owner can add people.");
      },
      as,
    );

    // 2. Create the logins, then the memberships in one step. If that step fails the
    //    logins just created are removed, so nothing is left behind.
    const prepared = await prepareLogins(
      body.members.map((m) => ({ displayName: m.displayName, email: m.email, roleKeys: [], roleIds: m.roleIds, password: m.password })),
      options.authAdmin,
    );
    try {
      await inSubject(
        options.identityDatabase,
        sub,
        async (tx) => {
          await tx.query("select kpi.add_people_as_owner($1::uuid,$2::text::jsonb)", [tenantId, prepared.json]);
        },
        as,
      );
      if (options.mailer) {
        for (const person of prepared.people) {
          if (person.temporaryPassword) {
            try {
              await options.mailer.send(
                person.email,
                `Your Command Center Login Credentials`,
                [
                  `Hello,`,
                  ``,
                  `An administrator has provisioned your account on Command Center.`,
                  ``,
                  `Your Sign-In Credentials:`,
                  `• Work Email: ${person.email}`,
                  `• Temporary Password: ${person.temporaryPassword}`,
                  ``,
                  `Please sign in at your workspace login page and update your password.`,
                  ``,
                  `Command Center Security`,
                ].join("\n"),
              );
            } catch (mailErr) {
              console.error("Failed to deliver temporary credentials email:", mailErr);
            }
          }
        }
      }
      return InviteMembersResponseSchema.parse({ mode: "logins", members: prepared.people });
    } catch (error) {
      await prepared.undo();
      throw error;
    }
  });

  // A new temporary password for someone who forgot theirs. Only for a person who
  // belongs to this organization alone; the database checks that, and the owner,
  // before the key is used.
  app.post("/api/identity/organizations/:tenantId/members/:memberId/reset-password", async (req) => {
    const { tenantId, memberId } = input(z.object({ tenantId: uuid, memberId: uuid }), req.params);
    const body = req.body ? input(ResetPasswordRequestSchema.optional(), req.body) : undefined;
    if (!options.authAdmin) throw new ApiError("unavailable", "Resetting passwords is not set up on this deployment.");
    const sub = await subject(req);
    const login = await inSubject(
      options.identityDatabase,
      sub,
      async (tx) => {
        const [row] = await tx.query("select kpi.prepare_password_reset($1::uuid,$2::uuid) as subject", [tenantId, memberId]);
        return uuid.parse(row?.subject);
      },
      "kpi_identity_app",
    );
    const password = body?.password?.trim() || temporaryPassword();
    await options.authAdmin.resetPassword(login, password, false);
    return { temporaryPassword: password };
  });

  // --- Changing your own password, with a code sent to your email -------------
  //
  // Anyone signed in may use these for their own account, including someone who
  // still has a temporary password: this is how they replace it. The code is
  // stored only as a hash, tied to the person.
  const codeHash = (subject: string, code: string) => hash(`${subject}:${code}`);

  app.post("/api/identity/me/password-code", async (req) => {
    const me = await verifyAccessTokenClaims(req.headers.authorization, options.auth);
    if (!me.email) throw new ApiError("invalid_request", "Your account has no email address.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await inSubject(
      options.identityDatabase,
      me.sub,
      async (tx) => {
        await tx.query("select kpi.issue_email_code($1)", [codeHash(me.sub, code)]);
      },
      "kpi_identity_app",
    );
    if (options.mailer) {
      try {
        await options.mailer.send(
          me.email,
          `Your Command Center code: ${code}`,
          [
            `Your code is ${code}.`,
            "",
            "Use it to change your Command Center password. It works for 10 minutes.",
            "If you did not ask for it, ignore this email: your password stays as it is.",
          ].join("\n"),
        );
      } catch {
        throw new ApiError("unavailable", "The email could not be sent. Try again in a minute.");
      }
    }
    return PasswordCodeResponseSchema.parse({
      sentTo: maskEmail(me.email),
      expiresInMinutes: 10,
      debugCode: process.env.NODE_ENV === "test" ? code : undefined,
    });
  });

  app.post("/api/identity/me/password", async (req) => {
    if (!options.authAdmin) throw new ApiError("unavailable", "Changing passwords is not set up on this deployment.");
    const me = await verifyAccessTokenClaims(req.headers.authorization, options.auth);
    const body = input(ChangeOwnPasswordRequestSchema, req.body);
    if (me.email && body.password.trim().toLowerCase() === me.email.toLowerCase())
      throw new ApiError("invalid_request", "Your password cannot be your email address.");
    const code = body.code?.trim();
    if (!code) {
      throw new ApiError("invalid_request", "Verification code is required. Please validate your email with the 6-digit OTP code.");
    }
    // The result is committed before anything is refused, so a wrong code always counts as an attempt.
    const right = await inSubject(
      options.identityDatabase,
      me.sub,
      async (tx) => {
        const [row] = await tx.query("select kpi.use_email_code($1) as ok", [codeHash(me.sub, code)]);
        return row?.ok === true;
      },
      "kpi_identity_app",
    );
    if (!right) throw new ApiError("invalid_request", "That code is not right. Check the latest email and try again.");
    await options.authAdmin.setOwnPassword(me.sub, body.password);
    await inSubject(
      options.identityDatabase,
      me.sub,
      async (tx) => {
        await tx.query("select kpi.mark_owner_credentials_verified()");
      },
      "kpi_identity_app",
    );
    return { ok: true };
  });

  app.post("/api/identity/organizations/:tenantId/invitations/send-mail", async (req) => {
    const { tenantId } = input(z.object({ tenantId: uuid }), req.params);
    const body = input(SendInviteMailRequestSchema, req.body);
    const sub = await subject(req);

    await inSubject(
      options.identityDatabase,
      sub,
      async (tx) => {
        const [row] = await tx.query("select kpi.is_owner($1::uuid) as allowed", [tenantId]);
        if (row?.allowed !== true) throw new ApiError("forbidden", "Only the organization's owner can invite members.");
      },
      "kpi_identity_app",
    );

    const host = req.headers.origin || "https://cmd-web-dun.vercel.app";
    const inviteUrl = `${host}/invite?email=${encodeURIComponent(body.email)}#${body.token}`;

    if (options.mailer) {
      const rolesDesc = body.roleNames.length ? ` for role(s): ${body.roleNames.join(", ")}` : "";
      try {
        await options.mailer.send(
          body.email,
          "Invitation to join Command Center & Set Your Password",
          [
            "Hello,",
            "",
            `You have been invited to join Command Center${rolesDesc}.`,
            "",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "YOUR LOGIN CREDENTIALS",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            `Login ID / Username: ${body.email}`,
            "",
            "Your email address is your permanent Login ID. To set your account password and access your workspace, please click the secure link below:",
            inviteUrl,
            "",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "HOW TO ACCESS YOUR ACCOUNT:",
            `1. Open the secure link: ${inviteUrl}`,
            `2. Your Login ID (${body.email}) will be verified.`,
            "3. Choose and confirm your new password.",
            "4. You will immediately access your role-authorized workspace.",
            "",
            "This invitation link is private and single-use.",
            "",
            "Command Center Platform",
          ].join("\n"),
        );
      } catch (err) {
        console.error("Failed to deliver invite email via identity options.mailer", err);
      }
    }

    return SendInviteMailResponseSchema.parse({ sent: true, sentTo: maskEmail(body.email) });
  });

  // --- Forgot Password OTP Flow ----------------------------------------------
  // 1. Request OTP: validate email and dispatch 6-digit verification code
  app.post("/api/identity/password-reset/request-otp", async (req) => {
    const { email } = input(RequestPasswordResetOtpRequestSchema, req.body);
    const normalized = email.trim().toLowerCase();

    // Verify account exists before generating OTP so user isn't misled
    const db = options.identityDatabase ?? options.database;
    if (db) {
      try {
        const users = await runQuery(
          db,
          "SELECT id FROM auth_users WHERE LOWER(email) = LOWER(?)",
          [normalized],
        );
        if (Array.isArray(users) && users.length === 0) {
          throw new ApiError("not_found", "No account found with this email address. Please check your email or contact your administrator.");
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }

    const code = String(randomInt(100_000, 1_000_000));
    const codeHash = hash(`reset:${normalized}:${code}`);

    passwordResetOtps.set(normalized, {
      codeHash,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      attempts: 0,
      verified: false,
    });

    // Persist to kpi_email_codes in database if available
    if (db) {
      try {
        await runQuery(
          db,
          "UPDATE kpi_email_codes SET expires_at = NOW(6) WHERE subject = ? AND used_at IS NULL AND expires_at > NOW(6)",
          [normalized],
        );
        await runQuery(
          db,
          "INSERT INTO kpi_email_codes (id, subject, purpose, code_hash, created_at, expires_at) VALUES (UUID(), ?, 'password', ?, NOW(6), DATE_ADD(NOW(6), INTERVAL 10 MINUTE))",
          [normalized, codeHash],
        );
      } catch {
        // Fallback to in-memory store
      }
    }

    if (options.mailer) {
      try {
        await options.mailer.send(
          email,
          `Your Command Center Password Reset Code: ${code}`,
          [
            "Hello,",
            "",
            `Your password reset verification code is: ${code}`,
            "",
            "Enter this 6-digit code on the reset page to verify your identity and choose a new password.",
            "This code will expire in 10 minutes.",
            "",
            "If you did not request a password reset, please ignore this email. Your password will remain unchanged.",
            "",
            "Command Center Security",
          ].join("\n"),
        );
      } catch (err) {
        console.error("Failed to send password reset OTP email", err);
        throw new ApiError("unavailable", "The verification code email could not be delivered. Please try again shortly.");
      }
    }

    return RequestPasswordResetOtpResponseSchema.parse({
      sentTo: maskEmail(email),
      expiresInMinutes: 10,
      debugCode: process.env.NODE_ENV === "test" ? code : undefined,
    });
  });

  // 2. Verify OTP: first validate email by OTP before giving permission to change password
  app.post("/api/identity/password-reset/verify-otp", async (req) => {
    const body = input(VerifyPasswordResetOtpRequestSchema, req.body);
    const normalized = body.email.trim().toLowerCase();
    const record = passwordResetOtps.get(normalized);
    const db = options.identityDatabase ?? options.database;

    let verified = false;

    // Validate against stored code
    if (record && record.expiresAt >= Date.now()) {
      const testHash = hash(`reset:${normalized}:${body.otpCode}`);
      if (record.codeHash === testHash) {
        verified = true;
      }
    }

    if (!verified && db) {
      try {
        const rows = await runQuery(
          db,
          "SELECT id, code_hash, attempts FROM kpi_email_codes WHERE subject = ? AND used_at IS NULL AND expires_at > NOW(6) ORDER BY created_at DESC LIMIT 1",
          [normalized],
        );
        if (Array.isArray(rows) && rows.length > 0) {
          const row = (rows as any[])[0];
          const testHash = hash(`reset:${normalized}:${body.otpCode}`);
          if (row.code_hash === testHash) {
            verified = true;
            await runQuery(db, "UPDATE kpi_email_codes SET used_at = NOW(6) WHERE id = ?", [row.id]);
          }
        }
      } catch {
        // Fallback already checked
      }
    }

    if (!verified) {
      if (record) record.attempts += 1;
      throw new ApiError("invalid_request", "Incorrect verification code. Please check your email and try again.");
    }

    const resetToken = randomUUID();
    if (record) {
      record.verified = true;
      record.resetToken = resetToken;
    } else {
      passwordResetOtps.set(normalized, {
        codeHash: "",
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0,
        verified: true,
        resetToken,
      });
    }

    return VerifyPasswordResetOtpResponseSchema.parse({
      ok: true,
      email: normalized,
      resetToken,
    });
  });

  // 3. Confirm Password Reset: user sets new password once permission has been unlocked by OTP
  app.post("/api/identity/password-reset/confirm", async (req) => {
    const body = input(ConfirmPasswordResetRequestSchema, req.body);
    const normalized = body.email.trim().toLowerCase();
    const record = passwordResetOtps.get(normalized);

    if (!record || !record.verified || record.resetToken !== body.resetToken || record.expiresAt < Date.now()) {
      throw new ApiError("forbidden", "Email verification required. Please verify your email with OTP first.");
    }

    if (body.password.trim().toLowerCase() === normalized) {
      throw new ApiError("invalid_request", "Your password cannot be your email address.");
    }

    const db = options.identityDatabase ?? options.database;
    let resetDone = false;
    if (options.authAdmin?.resetPasswordByEmail) {
      try {
        resetDone = await options.authAdmin.resetPasswordByEmail(normalized, body.password);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error("AuthAdmin reset error", err);
      }
    }

    if (db) {
      try {
        const pwdHash = hashPassword(body.password);
        await runQuery(
          db,
          "UPDATE auth_users SET password_hash = ?, must_change_password = 0, updated_at = NOW() WHERE LOWER(email) = LOWER(?)",
          [pwdHash, normalized],
        );
        resetDone = true;
      } catch {
        // Not a MySQL database with auth_users table
      }
    }

    if (!resetDone) {
      throw new ApiError("not_found", "No account found with this email address.");
    }

    passwordResetOtps.delete(normalized);

    return ConfirmPasswordResetResponseSchema.parse({
      ok: true,
      message: "Password changed successfully. You may now sign in.",
    });
  });
}

