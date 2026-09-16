const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@db/postgres' });

app.get('/results', function (req, res) {
  pool.query('SELECT choice, COUNT(id) AS total FROM votes GROUP BY choice', [], function (err, result) {
    res.json(result ? result.rows : []);
  });
});

module.exports = app;
