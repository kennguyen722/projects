import { WebSocketServer } from 'ws';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_WS || 'ws-gateway-group' });

const wss = new WebSocketServer({ port: Number(process.env.WS_PORT || 8080) });

const clients = new Set<any>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

async function broadcast(topic: string, payload: any) {
  const msg = JSON.stringify({ topic, payload });
  for (const c of clients) c.send(msg);
}

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.KAFKA_TOPIC_INSIGHTS || 'logs.insights', fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const data = JSON.parse(message.value!.toString());
      await broadcast(topic, data);
    }
  });
}

run().catch(console.error);
