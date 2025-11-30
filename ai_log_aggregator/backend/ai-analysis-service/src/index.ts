import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_AI || 'ai-analysis-group' });
const producer = kafka.producer();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function analyze(message: string) {
  try {
    const completion = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: `Classify log severity and anomaly likelihood, and propose remediation: ${message}`
    });
    const text = completion.output_text || 'unknown';
    return { summary: text, confidence: 0.5 };
  } catch (e) {
    return { summary: 'analysis_failed', confidence: 0 };
  }
}

async function run() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.KAFKA_TOPIC_NORMALIZED || 'logs.normalized', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const data = JSON.parse(message.value!.toString());
      const insight = await analyze(data.message);
      const result = { ...data, insight };
      await producer.send({ topic: process.env.KAFKA_TOPIC_INSIGHTS || 'logs.insights', messages: [{ value: JSON.stringify(result) }] });
    }
  });
}

run().catch(console.error);
