import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import express from 'express';
import cors from 'cors';

dotenv.config();

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_STORAGE || 'storage-service-group' });

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/logs'
});

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS logs(
    id SERIAL PRIMARY KEY,
    source TEXT,
    level TEXT,
    message TEXT,
    timestamp TIMESTAMPTZ,
    insight JSONB
  );`);
}

async function run() {
  await ensureSchema();
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.KAFKA_TOPIC_INSIGHTS || 'logs.insights', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const data = JSON.parse(message.value!.toString());
      await pool.query('INSERT INTO logs(source, level, message, timestamp, insight) VALUES($1,$2,$3,$4,$5)', [
        data.source, data.level, data.message, data.timestamp, JSON.stringify(data.insight)
      ]);
    }
  });
}

// lightweight HTTP API for recent logs
const app = express();
app.use(cors({ exposedHeaders: ['X-Total-Count'] }));
app.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const levelsParam = (req.query.levels as string | undefined)?.trim();
    const source = (req.query.source as string | undefined)?.trim();
    const sinceMinutes = parseInt(String(req.query.sinceMinutes ?? ''), 10);

    const params: any[] = [];
    const clauses: string[] = [];
    let i = 1;

    if (levelsParam) {
      const arr = levelsParam.split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) {
        clauses.push(`level = ANY($${i++})`);
        params.push(arr);
      }
    }
    if (source) {
      clauses.push(`source = $${i++}`);
      params.push(source);
    }
    if (!Number.isNaN(sinceMinutes) && sinceMinutes > 0) {
      const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
      clauses.push(`timestamp >= $${i++}`);
      params.push(since.toISOString());
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // total count for given filters
    const countSql = `SELECT COUNT(*)::int AS total FROM logs ${where}`;
    const baseParams = [...params];
    const countRes = await pool.query<{ total: number }>(countSql, baseParams);
    const total = countRes.rows[0]?.total ?? 0;

    // paged data
    const sql = `SELECT id, source, level, message, timestamp, insight FROM logs ${where} ORDER BY id DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(limit, offset);
    const { rows } = await pool.query(sql, params);

    res.setHeader('X-Total-Count', String(total));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
const port = Number(process.env.HTTP_PORT || 4000);
app.listen(port, () => {
  console.log(`storage-service HTTP listening on :${port}`);
});

run().catch(console.error);
