// Generic "you have a new message" email, branded per project ({{appName}}).
// The body is operator- or user-written prose, so it is escaped and
// paragraph-wrapped by server/utils/messageEmail.ts before it is interpolated
// — never drop raw input into {{bodyHtml}}.
const messageEmailTemplate = `
<section class="message-content" style="margin: 0; padding: 0; background-color: #eef2f7">
  <span
    style="display: none; font-size: 1px; color: #333333; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden;"
  >
    {{preheader}}
  </span>

  <table
    width="100%"
    border="0"
    cellspacing="0"
    cellpadding="0"
    bgcolor="#EEF2F7"
    style="width: 100%; border-collapse: collapse; table-layout: fixed; background-color: #eef2f7; margin: 0; padding: 0;"
  >
    <tbody>
      <tr>
        <td align="center" valign="top" style="padding: 32px 16px 40px 16px;">
          <table
            width="100%"
            border="0"
            cellspacing="0"
            cellpadding="0"
            style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);"
          >
            <tbody>
              <tr>
                <td style="padding: 40px 36px 4px 36px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                  <p style="margin: 0 0 4px 0; font-size: 12px; line-height: 1.4; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">
                    {{appName}}
                  </p>
                  <h1 style="margin: 0 0 16px 0; font-size: 22px; line-height: 1.3; color: #0f172a; font-weight: 700;">
                    {{subject}}
                  </h1>
                  <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #0f172a;">
                    {{greeting}}
                  </p>
                  {{bodyHtml}}
                </td>
              </tr>
              {{ctaBlock}}
              <tr>
                <td style="padding: 8px 36px 40px 36px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                  <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #94a3b8;">
                    You can reply to this conversation from your {{appName}} inbox.
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
          <p style="margin: 20px auto 0 auto; max-width: 520px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #94a3b8; text-align: center;">
            You are receiving this because you have a {{appName}} account.
          </p>
          {{poweredBy}}
        </td>
      </tr>
    </tbody>
  </table>
</section>
`

export default messageEmailTemplate
