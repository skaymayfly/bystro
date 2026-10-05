/**
 * Test doubles for automated tests only. Never wire these into the running application:
 * a mock must not stand in for a real integration (see CLAUDE.md).
 */
import type { EmailMessage, EmailSender } from "@bystro/core";

/** Records e-mails in memory instead of sending them. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ id: string }> {
    this.sent.push(message);
    return { id: `fake-${this.sent.length}` };
  }
}
