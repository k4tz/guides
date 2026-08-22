import fs from 'node:fs';

console.log('sync: start');
setTimeout(() => console.log('timer'), 0);
setImmediate(() => console.log('immediate'));
Promise.resolve().then(() => console.log('promise'));
queueMicrotask(() => console.log('queueMicrotask'));
process.nextTick(() => console.log('nextTick'));
fs.readFile(new URL('../package.json', import.meta.url), () => {
  console.log('I/O callback');
  setImmediate(() => console.log('immediate from I/O'));
  setTimeout(() => console.log('timer from I/O'), 0);
});
console.log('sync: end');
console.log('note: this file is ESM; nextTick/microtask ordering differs from a CommonJS entrypoint in modern Node.js');
