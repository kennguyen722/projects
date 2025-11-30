import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ALERT || 'alert-service-group' });

async function sendAlert(payload: any) {
  // TODO: integrate Slack/Email/SMS; placeholder logs
  console.log('ALERT:', JSON.stringify(payload));
}

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.KAFKA_TOPIC_INSIGHTS || 'logs.insights', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const data = JSON.parse(message.value!.toString());
      if (data.insight?.summary?.toLowerCase().includes('error')) {
        await sendAlert({ type: 'error', data });
      }
    }
  });
}

run().catch(console.error);
