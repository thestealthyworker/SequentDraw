// A demo that is NOT referenced by any manifest or compose build context,
// so it is excluded -- but as an AMBIGUOUS exclusion, reported in the
// bundle so the skill can ask. The `twilio` import is the tripwire.
const twilio = require('twilio');

module.exports = { twilio };
