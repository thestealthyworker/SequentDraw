// Test-only helper. The `stripe` import here is a tripwire: if it ever
// reaches the bundle, the relevance policy stopped excluding test
// directories nested inside a product directory.
const stripe = require('stripe');

module.exports = { stripe };
