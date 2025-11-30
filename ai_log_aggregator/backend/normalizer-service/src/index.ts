import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_NORMALIZER || 'normalizer-group' });
const producer = kafka.producer();

const RawSchema = z.object({ source: z.string(), level: z.string(), message: z.string(), timestamp: z.string().optional(), context: z.record(z.any()).optional() });

function normalize(log: any) {
  const level = ['debug','info','warn','error'].includes(String(log.level)) ? log.level : 'info';
  return { source: String(log.source), level, message: String(log.message), timestamp: log.timestamp ?? new Date().toISOString(), context: log.context ?? {} };
}

async function run() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.KAFKA_TOPIC_RAW || 'logs.raw', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const data = JSON.parse(message.value!.toString());
        const parsed = RawSchema.safeParse(data);
        if (!parsed.success) return;
        const n = normalize(parsed.data);
        await producer.send({ topic: process.env.KAFKA_TOPIC_NORMALIZED || 'logs.normalized', messages: [{ value: JSON.stringify(n) }] });
      } catch (e) {}
    }
  });
}

run().catch(console.error);
