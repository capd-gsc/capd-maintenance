// Test settings: Postgres connection from PGHOST / PGPORT / PGUSER / PGPASSWORD / CAPD_TEST_DB
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const pg = { host: process.env.PGHOST || 'localhost', port: +(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || undefined, database: process.env.CAPD_TEST_DB || 'capd_test' };
module.exports = { ROOT, pg, url: 'file://' + path.join(ROOT, 'index.html'), client: path.join(__dirname, 'client.js'), sql: f => path.join(ROOT, 'supabase', f) };
