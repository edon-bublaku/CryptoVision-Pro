"use client";

import { BellRing, Copy, KeyRound, Laptop, Loader2, LogOut, Mail, Send, ShieldAlert, ShieldCheck, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Segmented, Switch } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { errorMessage, useAuth, type PublicUser } from "@/lib/store/auth";
import { useSettings } from "@/lib/store/settings";
import { timeAgo } from "@/lib/utils";

interface SessionRow {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

function device(ua: string | null): string {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function AccountPage() {
  const t = useT();
  const router = useRouter();
  const { user, ready, health, setUser, logout } = useAuth();
  const lang = useSettings((s) => s.lang);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/account");
  }, [ready, user, router]);

  if (!user)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-accent" />
      </div>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-8">
      <PageHeader icon={<UserRound size={20} />} title={t("account.title")} subtitle={t("account.subtitle")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Profile user={user} onSaved={setUser} />
        <TwoFactor user={user} onChange={setUser} />
        <Notifications user={user} onSaved={setUser} pushKey={health?.push ?? null} />
        <PasswordCard />
      </div>
      <Sessions lang={lang} />
      <Card className="border-bear/30">
        <CardHeader title={<span className="text-bear">{t("account.danger")}</span>} subtitle={t("account.deleteConfirm")} />
        <div className="flex flex-wrap gap-2 p-5">
          <Button
            variant="danger"
            onClick={async () => {
              const password = window.prompt(t("account.deleteConfirm"));
              if (!password) return;
              try {
                await api("/api/account", { method: "DELETE", body: { password } });
                setUser(null);
                router.push("/welcome");
              } catch (e) {
                toast({ title: errorMessage(e, t), tone: "warn" });
              }
            }}
          >
            <Trash2 size={14} /> {t("account.delete")}
          </Button>
          <Button
            onClick={async () => {
              await logout();
              router.push("/");
            }}
          >
            <LogOut size={14} /> {t("auth.logout")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Profile({ user, onSaved }: { user: PublicUser; onSaved: (u: PublicUser) => void }) {
  const t = useT();
  const [name, setName] = useState(user.name ?? "");
  const [locale, setLocale] = useState(user.locale);
  return (
    <Card>
      <CardHeader title={t("account.profile")} subtitle={user.email} right={<Badge tone={user.totpEnabled ? "bull" : "warn"}>{user.totpEnabled ? t("account.2faOn") : t("account.2faOff")}</Badge>} />
      <div className="space-y-4 p-5">
        <Field label={t("auth.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t("settings.language")}>
          <Segmented value={locale} onChange={setLocale} options={[{ value: "sq", label: "Shqip" }, { value: "en", label: "English" }]} />
        </Field>
        <Button
          variant="primary"
          onClick={async () => {
            const r = await api<{ user: PublicUser }>("/api/account", { method: "PATCH", body: { name: name || null, locale } });
            onSaved(r.user);
            toast({ title: t("account.saved"), tone: "success" });
          }}
        >
          {t("common.save")}
        </Button>
      </div>
    </Card>
  );
}

function TwoFactor({ user, onChange }: { user: PublicUser; onChange: (u: PublicUser) => void }) {
  const t = useT();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title={t("account.2fa")} subtitle={t("account.2faDesc")} right={user.totpEnabled ? <ShieldCheck className="text-bull" size={20} /> : <ShieldAlert className="text-warn" size={20} />} />
      <div className="space-y-4 p-5">
        {codes ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("account.recovery")}</p>
            <p className="text-xs text-muted">{t("account.recoveryDesc")}</p>
            <div className="num grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-panel-2 p-3 text-sm">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(codes.join("\n"));
                toast({ title: "✓", tone: "success" });
              }}
            >
              <Copy size={13} /> Copy
            </Button>
          </div>
        ) : user.totpEnabled ? (
          <>
            <p className="text-sm text-muted">
              <b className="text-fg">{user.recoveryCodesLeft}</b> {t("account.recoveryLeft")}
            </p>
            <Button
              variant="secondary"
              onClick={async () => {
                const password = window.prompt(t("account.current"));
                const c = password ? window.prompt(t("auth.codeHint")) : null;
                if (!password || !c) return;
                try {
                  await api("/api/auth/2fa/disable", { body: { password, code: c } });
                  onChange({ ...user, totpEnabled: false, recoveryCodesLeft: 0 });
                } catch (e) {
                  toast({ title: errorMessage(e, t), tone: "warn" });
                }
              }}
            >
              {t("account.2faDisable")}
            </Button>
          </>
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">{t("account.2faScan")}</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="h-40 w-40 overflow-hidden rounded-xl bg-white p-1.5" dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <code className="num max-w-full break-all rounded-lg bg-panel-2 px-2 py-1 text-xs">{setup.secret}</code>
            </div>
            <div className="flex gap-2">
              <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="num w-36 text-center tracking-[0.3em]" />
              <Button
                variant="primary"
                disabled={code.length !== 6}
                onClick={async () => {
                  setError(null);
                  try {
                    const r = await api<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { body: { code } });
                    setCodes(r.recoveryCodes);
                    onChange({ ...user, totpEnabled: true, recoveryCodesLeft: r.recoveryCodes.length });
                  } catch (e) {
                    setError(errorMessage(e, t));
                  }
                }}
              >
                {t("account.2faConfirm")}
              </Button>
            </div>
            {error && <p className="text-sm text-bear">{error}</p>}
          </div>
        ) : (
          <Button variant="primary" onClick={async () => setSetup(await api<{ secret: string; qr: string }>("/api/auth/2fa/setup", { body: {} }))}>
            <KeyRound size={14} /> {t("account.2faSetup")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function Notifications({ user, onSaved, pushKey }: { user: PublicUser; onSaved: (u: PublicUser) => void; pushKey: string | null }) {
  const t = useT();
  const health = useAuth((s) => s.health);
  const [chat, setChat] = useState(user.telegramChatId ?? "");
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistration().then(async (reg) => setPushOn(!!(await reg?.pushManager.getSubscription())));
  }, []);

  const togglePush = async (on: boolean) => {
    if (!pushKey) return;
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    if (on) {
      if ((await Notification.requestPermission()) !== "granted") return;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushKey) });
      await api("/api/push", { body: sub.toJSON() });
      setPushOn(true);
    } else {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api("/api/push", { method: "DELETE", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setPushOn(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t("account.notifications")} subtitle={health?.worker ? "Worker · 24/7" : undefined} />
      <div className="space-y-5 p-5">
        <Field label={t("account.telegramChat")} hint={t("account.telegramHelp")}>
          <div className="flex gap-2">
            <Input value={chat} onChange={(e) => setChat(e.target.value.trim())} placeholder="123456789" />
            <Button
              disabled={!health?.telegram}
              onClick={async () => {
                try {
                  const r = await api<{ user: PublicUser; telegram?: boolean }>("/api/account", { method: "PATCH", body: { telegramChatId: chat || null, testTelegram: true } });
                  onSaved(r.user);
                  toast({ title: r.telegram ? "Telegram ✓" : t("account.saved"), tone: "success" });
                } catch (e) {
                  toast({ title: errorMessage(e, t), tone: "warn" });
                }
              }}
            >
              <Send size={13} /> {t("account.telegramTest")}
            </Button>
          </div>
        </Field>
        <Switch
          checked={user.emailAlerts}
          onChange={async (v) => onSaved((await api<{ user: PublicUser }>("/api/account", { method: "PATCH", body: { emailAlerts: v } })).user)}
          label={
            <span className="flex items-center gap-1.5">
              <Mail size={14} /> {t("account.emailAlerts")} {!health?.email && <span className="text-xs text-faint">(—)</span>}
            </span>
          }
        />
        {pushKey ? (
          <Switch
            checked={pushOn}
            onChange={(v) => void togglePush(v).catch((e: unknown) => toast({ title: String(e), tone: "warn" }))}
            label={
              <span className="flex items-center gap-1.5">
                <BellRing size={14} /> {t("account.push")}
              </span>
            }
          />
        ) : (
          <p className="text-xs text-faint">{t("account.pushUnavailable")}</p>
        )}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  return (
    <Card>
      <CardHeader title={t("account.password")} />
      <form
        className="space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/auth/password", { body: { current, next } });
            setCurrent("");
            setNext("");
            toast({ title: t("account.saved"), tone: "success" });
          } catch (err) {
            toast({ title: errorMessage(err, t), tone: "warn" });
          }
        }}
      >
        <Field label={t("account.current")}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label={t("account.new")} hint={t("auth.passwordRule")}>
          <Input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button variant="primary" disabled={!current || next.length < 10}>
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

function Sessions({ lang }: { lang: "sq" | "en" }) {
  const t = useT();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [audit, setAudit] = useState<{ action: string; ip: string | null; createdAt: string }[]>([]);
  const load = useCallback(async () => {
    setRows((await api<{ sessions: SessionRow[] }>("/api/auth/sessions")).sessions);
    setAudit((await api<{ audit: { action: string; ip: string | null; createdAt: string }[] }>("/api/account")).audit);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={t("account.sessions")}
          right={
            <Button size="xs" onClick={async () => (await api("/api/auth/sessions", { method: "DELETE" }), load())}>
              {t("account.revokeOthers")}
            </Button>
          }
        />
        {!rows ? (
          <div className="p-5">
            <Loader2 className="animate-spin text-accent" size={18} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <Laptop size={18} className="text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {device(s.userAgent)} {s.current && <Badge tone="accent">{t("account.current_session")}</Badge>}
                  </div>
                  <div className="num text-xs text-faint">
                    {s.ip ?? "—"} · {timeAgo(new Date(s.lastSeenAt).getTime(), lang)}
                  </div>
                </div>
                {!s.current && (
                  <Button size="xs" variant="ghost" onClick={async () => (await api(`/api/auth/sessions?id=${s.id}`, { method: "DELETE" }), load())}>
                    {t("account.revoke")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t("account.activity")} />
        {audit.length === 0 ? (
          <Empty title="—" />
        ) : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {audit.map((a, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                <span className="num text-xs text-faint">
                  {a.ip ?? ""} · {timeAgo(new Date(a.createdAt).getTime(), lang)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="px-5 py-3 text-[11px] text-faint">
          <Link href="/settings" className="hover:text-muted">
            {t("nav.settings")} →
          </Link>
        </p>
      </Card>
    </div>
  );
}
