import { z } from 'zod';

const LogSchema = z.object({
  source: z.string(),
  level: z.enum(['debug','info','warn','error']),
  message: z.string(),
});

test('valid log schema', () => {
  expect(LogSchema.safeParse({ source: 'app', level: 'info', message: 'hello' }).success).toBe(true);
});

test('invalid level rejected', () => {
  expect(LogSchema.safeParse({ source: 'app', level: 'fatal', message: 'hello' }).success).toBe(false);
});
