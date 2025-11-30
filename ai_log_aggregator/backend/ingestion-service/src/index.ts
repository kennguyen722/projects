import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Kafka } from 'kafkajs';
import { z } from 'zod';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const producer = kafka.producer();

const LogSchema = z.object({
  source: z.string(),
  level: z.enum(['debug','info','warn','error']),
  message: z.string(),
  timestamp: z.string().optional(),
  context: z.record(z.any()).optional()
});

app.post('/ingest', async (req, res) => {
  const parsed = LogSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const payload = { ...parsed.data, timestamp: parsed.data.timestamp ?? new Date().toISOString() };
  try {
    await producer.connect();
    await producer.send({ topic: process.env.KAFKA_TOPIC_RAW || 'logs.raw', messages: [{ value: JSON.stringify(payload) }] });
    return res.status(202).json({ status: 'queued' });
  } catch (e) {
    return res.status(500).json({ error: 'kafka_produce_failed' });
  } finally {
    await producer.disconnect();
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`ingestion-service listening on ${port}`));
