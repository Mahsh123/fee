import { Client } from 'pg';
const c = new Client({connectionString: 'postgresql://neondb_owner:npg_yHC63tYkNnoE@ep-solitary-term-b3dm6pxz-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'});
c.connect().then(() => c.query(`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname IN ('neondb_owner','fee_runtime','neondb_backup')`)).then(r => { console.log('Roles:', JSON.stringify(r.rows)); c.end(); }).catch(e => { console.error('error:', e.message); c.end(); process.exit(1); });
