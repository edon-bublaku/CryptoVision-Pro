"use client";

import { Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n";
import { errorMessage, useAuth } from "@/lib/store/auth";
import { cn } from "@/lib/utils";

/** Rough strength meter: length and character variety (no password is sent anywhere but our API). */
function strength(p: string): number {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const { register, health, user, ready } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = strength(password);

  useEffect(() => {
    if (ready && user) router.replace("/account");
  }, [ready, user, router]);

  return (
    <AuthLayout title={t("auth.registerTitle")} subtitle={t("auth.registerSub")}>
      {ready && !health?.db && <p className="mb-4 rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs text-warn">{t("auth.serverOff")}</p>}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await register(email, password, name || undefined);
          } catch (err) {
            setError(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("auth.name")}>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("auth.email")}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("auth.password")} hint={t("auth.passwordRule")}>
          <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="mt-1.5 grid grid-cols-4 gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cn("h-1 rounded-full", i < st ? (st >= 3 ? "bg-bull" : st === 2 ? "bg-warn" : "bg-bear") : "bg-line")} />
            ))}
          </div>
        </Field>
        {error && <p className="text-sm text-bear" role="alert">{error}</p>}
        <Button variant="primary" size="md" className="w-full" disabled={busy || !health?.db || password.length < 10}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {t("auth.register")}
        </Button>
        <p className="text-[11px] leading-relaxed text-faint">{t("disclaimer.short")}</p>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          {t("auth.login")}
        </Link>
      </p>
    </AuthLayout>
  );
}
