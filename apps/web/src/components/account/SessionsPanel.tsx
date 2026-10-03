"use client";

import type { SessionInfo } from "@antisismo/proto/account";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { describeUserAgent } from "@/lib/auth/helpers";

import { useAuth } from "../auth/AuthProvider";
import { useErrorText } from "../auth/shared";
import { FormAlert } from "../forms/FormAlert";
import { dangerButtonClass, secondaryButtonClass } from "../forms/SubmitButton";
import { Icon } from "../Icon";

const sortSessions = (sessions: SessionInfo[]) => [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt - a.lastUsedAt);

type Load = { status: "loading" } | { status: "ready"; sessions: SessionInfo[] } | { status: "error"; message: string };

export function SessionsPanel() {
  const t = useTranslations();
  const format = useFormatter();
  const { client } = useAuth();
  const errorText = useErrorText();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { sessions } = await client.sessions();
      setLoad({ status: "ready", sessions: sortSessions(sessions) });
    } catch (err) {
      setLoad({ status: "error", message: errorText(err) });
    }
  }, [client, errorText]);

  useEffect(() => {
    let alive = true;
    client.sessions().then(
      ({ sessions }) =>
        alive &&
        setLoad({ status: "ready", sessions: sortSessions(sessions) }),
      (err: unknown) => alive && setLoad({ status: "error", message: errorText(err) }),
    );
    return () => {
      alive = false;
    };
  }, [client, errorText]);

  async function run(id: string, action: () => Promise<string>) {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      setNotice({ tone: "success", text: await action() });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const when = (ms: number) => format.dateTime(ms, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">{t("account.sessionsPage.title")}</h1>
        <p className="text-text-muted">{t("account.sessionsPage.lead")}</p>
      </header>
      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}
      {load.status === "loading" ? (
        <p role="status" className="text-text-muted">
          {t("states.loading")}
        </p>
      ) : null}
      {load.status === "error" ? (
        <div className="flex flex-col gap-3">
          <FormAlert tone="error" focus={false}>
            {load.message}
          </FormAlert>
          <button
            type="button"
            className={`${secondaryButtonClass} self-start`}
            onClick={() => {
              setLoad({ status: "loading" });
              void refresh();
            }}
          >
            {t("states.retry")}
          </button>
        </div>
      ) : null}
      {load.status === "ready" ? (
        <>
          <ul className="flex flex-col gap-3">
            {load.sessions.map((s) => {
              const ua = describeUserAgent(s.userAgent);
              const device = ua.browser && ua.os ? t("account.sessionsPage.device", ua) : t("account.sessionsPage.unknownDevice");
              return (
                <li key={s.id} className="flex flex-col gap-3 rounded-[20px] border border-white/10 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Icon name="devices" className="mt-0.5 size-6 shrink-0 text-accent-cyan" />
                    <div className="flex flex-col gap-0.5">
                      <p className="font-semibold">
                        {device}
                        {s.current ? (
                          <span className="ml-2 rounded-full bg-safe-green-strong px-2 py-0.5 text-sm font-medium">{t("account.sessionsPage.current")}</span>
                        ) : null}
                      </p>
                      <p className="text-sm text-text-muted">{t("account.sessionsPage.lastUsed", { date: when(s.lastUsedAt) })}</p>
                      <p className="text-sm text-text-muted">{t("account.sessionsPage.started", { date: when(s.createdAt) })}</p>
                      {s.mfa ? <p className="text-sm text-text-muted">{t("account.sessionsPage.mfa")}</p> : null}
                    </div>
                  </div>
                  {!s.current ? (
                    <button
                      type="button"
                      className={dangerButtonClass}
                      aria-disabled={busy !== null}
                      onClick={() =>
                        run(s.id, async () => {
                          await client.revokeSession(s.id);
                          return t("account.sessionsPage.revoked");
                        })
                      }
                    >
                      {t("account.sessionsPage.revoke")}
                      <span className="sr-only">: {device}</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {load.sessions.some((s) => !s.current) ? (
            <button
              type="button"
              className={`${dangerButtonClass} self-start`}
              aria-disabled={busy !== null}
              onClick={() =>
                run("others", async () => {
                  const { revoked } = await client.revokeOtherSessions();
                  return t("account.sessionsPage.revokedOthers", { count: revoked });
                })
              }
            >
              {t("account.sessionsPage.revokeOthers")}
            </button>
          ) : (
            <p className="text-text-muted">{t("account.sessionsPage.empty")}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
