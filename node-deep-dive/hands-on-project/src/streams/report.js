import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function createOrderReportStream(count = 100_000) {
  const source = Readable.from((function* () {
    yield 'id,customer,totalCents,status\n';
    for (let i = 1; i <= count; i += 1) {
      yield `${i},customer-${i % 1000},${1000 + (i % 5000)},${i % 3 === 0 ? 'PAID' : 'PENDING'}\n`;
    }
  })());
  const transform = new Transform({
    transform(chunk, encoding, callback) { callback(null, chunk); },
    highWaterMark: 16 * 1024
  });
  return { source, transform };
}

export async function streamOrderReport(res, count) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="orders.csv"'
  });
  const { source, transform } = createOrderReportStream(count);
  await pipeline(source, transform, res);
}
