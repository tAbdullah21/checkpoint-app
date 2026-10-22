// Human usefulness evaluation. Export freezes five real recommendations; only the participant supplies
// the 1–5 usefulness scores. Demo accounts cannot be exported. Reporting never invents missing feedback.
const fs = require('node:fs');
require('dotenv').config({ quiet: true });

const FORMAT = 'checkpoint-recommendation-evaluation/1';
const TOP_K = 5;
const MIN_PARTICIPANTS = 10;
const TARGET_PERCENT = 70;

function validatePick(pick, index) {
  if (pick.rank !== index + 1 || !pick.slug || !pick.title) throw new Error('Keep the exported game identities and rank order.');
  if (pick.usefulness !== null && (!Number.isInteger(pick.usefulness) || pick.usefulness < 1 || pick.usefulness > 5)) {
    throw new Error('Usefulness must be null (unanswered) or a whole number from 1 to 5.');
  }
}

function validateSnapshot(snapshot) {
  if (snapshot?.format !== FORMAT || !/^P\d{2,3}$/.test(snapshot.participantId || '')) {
    throw new Error('Use the evaluation export format and an anonymous participant ID such as P01.');
  }
  if (!Number.isInteger(snapshot.accountId) || snapshot.accountId < 1) throw new Error('Invalid account ID.');
  if (snapshot.synthetic !== false) throw new Error('Synthetic feedback cannot be used for acceptance.');
  if (!Array.isArray(snapshot.picks) || snapshot.picks.length !== TOP_K) throw new Error('Each participant must assess exactly five frozen picks.');
  if (new Set(snapshot.picks.map((pick) => pick.slug)).size !== TOP_K) throw new Error('Repeated picks are not allowed.');
  snapshot.picks.forEach(validatePick);
  return snapshot;
}

function summarize(snapshots) {
  const participants = new Set();
  const accounts = new Set();
  const versions = new Set();
  let answered = 0;
  let useful = 0;
  const perParticipant = [];
  for (const value of snapshots) {
    const snapshot = validateSnapshot(value);
    if (participants.has(snapshot.participantId) || accounts.has(snapshot.accountId)) throw new Error('A participant/account may appear only once.');
    participants.add(snapshot.participantId);
    accounts.add(snapshot.accountId);
    versions.add(snapshot.appVersion);
    const scores = snapshot.picks.map((pick) => pick.usefulness).filter((score) => score !== null);
    const relevant = scores.filter((score) => score >= 4).length;
    answered += scores.length;
    useful += relevant;
    perParticipant.push({ participantId: snapshot.participantId, answered: scores.length, useful: relevant, precisionAt5: scores.length === TOP_K ? relevant / TOP_K : null });
  }
  if (versions.size > 1) throw new Error('Do not mix app versions in one evaluation.');
  const complete = participants.size >= MIN_PARTICIPANTS && answered === participants.size * TOP_K;
  const percent = answered ? Math.round(useful / answered * 10000) / 100 : null;
  return {
    metric: 'Human-rated Precision@5 (usefulness 4 or 5 counts as relevant)',
    targetPercent: TARGET_PERCENT, minimumParticipants: MIN_PARTICIPANTS,
    participants: participants.size, expectedAssessments: participants.size * TOP_K, answered, useful,
    usefulnessPercent: complete ? percent : null, provisionalAnsweredPercent: percent,
    status: complete ? (useful / answered * 100 >= TARGET_PERCENT ? 'target_met' : 'target_not_met') : 'pending_human_feedback',
    perParticipant,
    limitation: 'Small, self-reported student evaluation; not a prediction-accuracy or generalization claim.',
  };
}

function exportSnapshot(participantId, submittedId) {
  const accountId = Number(submittedId);
  if (!Number.isInteger(accountId) || accountId < 1) throw new Error('Use a positive integer account ID.');
  const { catalogueVersion, closeDatabase, findUserById } = require('../database/database');
  try {
    const user = findUserById(accountId);
    if (!user || user.email.endsWith('@demo.checkpoint.local')) throw new Error('Choose a real consenting participant account, not a demo account.');
    const { listRatingsByUser } = require('../database/community');
    if (!user.favorite_genres || listRatingsByUser(accountId).length < 3) throw new Error('First choose favorite genres and rate at least three familiar games.');
    const { picks, engine } = require('../lib/recommendations').recommendationsFor(accountId, { limit: TOP_K });
    if (engine !== 'python') throw new Error('Restore Python matching before exporting evaluation picks.');
    const snapshot = {
      format: FORMAT, appVersion: require('../package.json').version,
      participantId, accountId, synthetic: false, generatedAt: new Date().toISOString(),
      catalogueVersion: catalogueVersion(),
      instructions: 'The participant reads each game page, then supplies usefulness 1–5. Change only usefulness and note; leave unknown feedback null.',
      picks: picks.map((pick, index) => ({ rank: index + 1, slug: pick.game.slug, title: pick.game.title, match: pick.match, reason: pick.reason, usefulness: null, note: '' })),
    };
    return validateSnapshot(snapshot);
  } finally {
    closeDatabase();
  }
}

function main(args) {
  const [mode, ...values] = args;
  if (mode === 'export' && values.length === 2) return exportSnapshot(...values);
  if (mode === 'report' && values.length) return summarize(values.map((file) => JSON.parse(fs.readFileSync(file, 'utf8'))));
  throw new Error('Use: export P01 ACCOUNT_ID, or report PATH.json [PATH.json ...].');
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { FORMAT, MIN_PARTICIPANTS, TARGET_PERCENT, TOP_K, summarize, validateSnapshot };
