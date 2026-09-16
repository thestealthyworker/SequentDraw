// A maintenance script with SQL text but NO declared database client.
// The data-access rule must therefore attribute nothing to it: a SQL
// string alone is not evidence that a component talks to a store.
const QUERY = 'SELECT choice, COUNT(id) AS total FROM votes GROUP BY choice';

module.exports = { QUERY };
