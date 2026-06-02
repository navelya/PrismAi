import { Resend } from 'resend';

interface SendWorkflowInviteArgs {
    to: string;
    workflowName: string;
    inviterName: string;
    acceptUrl: string;
}

// Sends a workflow-collaboration invite. Errors are thrown to the caller, which
// catches them and reports a non-blocking warning (the invite row is already saved).
export async function sendWorkflowInvite(args: SendWorkflowInviteArgs): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ADMIN_ALERT_FROM || 'alerts@prismai.local';
    if (!apiKey) throw new Error('RESEND_API_KEY not configured');

    const resend = new Resend(apiKey);
    const subject = `${args.inviterName} invited you to collaborate on "${args.workflowName}"`;
    const html = `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="margin:0 0 12px">You've been invited to collaborate</h2>
          <p style="color:#444">${args.inviterName} invited you to the workflow
             <strong>${args.workflowName}</strong> on PrismAi.</p>
          <p style="margin:24px 0">
            <a href="${args.acceptUrl}"
               style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">
               Open workflow
            </a>
          </p>
          <p style="color:#888;font-size:12px">
             If the button doesn't work, paste this link: ${args.acceptUrl}
          </p>
        </div>`;
    await resend.emails.send({ from, to: args.to, subject, html });
}
