// STUB: real deployments send through SendGrid or Mailgun (tech_stack_document.md).
// No outbound email is possible here, so this just logs what would have been sent.
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  console.log(`[email stub] to=${to} subject="${subject}"\n${body}`);
}
