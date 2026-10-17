"use client";

import { KeyRound, Loader2, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n";
import { errorMessage, useAuth } from "@/lib/store/auth";

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const { login, health, user, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && user) router.replace(next.startsWith("/") ? next : "/");
  }, [ready, user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(email, password, needCode ? code : undefined);
      if (r === "totp") setNeedCode(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t("auth.loginTitle")} subtitle={t("auth.loginSub")}>
      {ready && !health?.db && <p className="mb-4 rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs text-warn">{t("auth.serverOff")}</p>}
      <form onSubmit={submit} className="space-y-4">
        {!needCode ? (
          <>
            <Field label={t("auth.email")}>
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={t("auth.password")}>
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label={t("auth.code")} hint={t("auth.codeHint")}>
            <Input autoFocus inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className="num text-center text-lg tracking-[0.4em]" />
          </Field>
        )}
        {error && <p className="text-sm text-bear" role="alert">{error}</p>}
        <Button variant="primary" size="md" className="w-full" disabled={busy || !health?.db}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : needCode ? <KeyRound size={16} /> : <LogIn size={16} />}
          {t("auth.login")}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t("auth.noAccount")}{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          {t("auth.register")}
        </Link>
      </p>
      <Link href="/" className="mt-3 block text-center text-xs text-faint hover:text-muted">
        {t("auth.continueLocal")}
      </Link>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
