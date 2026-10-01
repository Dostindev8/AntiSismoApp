import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

export function StateMessage({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-[20px] border border-white/10 bg-surface p-8 text-center">
      <Icon name={icon} className="size-10 text-accent-cyan" />
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="text-text-muted">{body}</p>
      {action}
    </div>
  );
}

export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-accent-blue px-5 font-semibold text-text-primary hover:brightness-110";
