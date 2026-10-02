export type MailTemplate = "verify-email" | "reset-password" | "account-exists" | "new-login" | "password-changed";

export interface MailMessage {
  to: string;
  template: MailTemplate;
  locale: string;
  vars: Record<string, string>;
}

export interface Mailer {
  readonly kind: "dev-outbox" | "smtp";
  send(message: MailMessage): Promise<void>;
}

const OUTBOX_CAP = 200;

/** Solo desarrollo/pruebas: guarda los correos en memoria. Producción exige un transporte real (BLK-19). */
export class DevOutboxMailer implements Mailer {
  readonly kind = "dev-outbox" as const;
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > OUTBOX_CAP) this.outbox.shift();
  }

  last(to: string, template: MailTemplate): MailMessage | undefined {
    for (let i = this.outbox.length - 1; i >= 0; i--) {
      const m = this.outbox[i];
      if (m && m.to === to && m.template === template) return m;
    }
    return undefined;
  }
}
