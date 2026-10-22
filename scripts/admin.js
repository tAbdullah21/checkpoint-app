/*
 * Moderators (members with the administrator role), managed from the command line so that no web page can
 * hand out the role.
 *
 *   npm run admin -- grant lina@example.com    make the member a moderator
 *   npm run admin -- revoke lina@example.com   make them a normal member again (works on their next page)
 *   npm run admin -- list                      show every moderator
 */
// The same settings as the server (DATABASE_PATH in .env), so the script changes the database the site uses.
require('dotenv').config({ quiet: true });
const { closeDatabase } = require('../database/database');
const { listAdmins, setRoleByEmail } = require('../database/moderation');

const USAGE = 'Usage: npm run admin -- grant <email> | revoke <email> | list';

function run([command, email]) {
  if (command === 'list') {
    const admins = listAdmins();
    if (admins.length === 0) return { ok: true, message: 'There are no moderators yet. Run "npm run admin -- grant <email>".' };
    return { ok: true, message: admins.map((admin) => `${admin.name} <${admin.email}>`).join('\n') };
  }
  if ((command === 'grant' || command === 'revoke') && email) {
    const member = setRoleByEmail(email, command === 'grant' ? 'admin' : 'member');
    if (!member) return { ok: false, message: `No account uses ${email}.` };
    return {
      ok: true,
      message: command === 'grant'
        ? `${member.name} is now a moderator. The Moderation page is in their account menu.`
        : `${member.name} is no longer a moderator.`,
    };
  }
  return { ok: false, message: USAGE };
}

try {
  const result = run(process.argv.slice(2).filter((argument) => argument !== '--'));
  (result.ok ? console.log : console.error)(result.message);
  if (!result.ok) process.exitCode = 1;
} finally {
  closeDatabase();
}
