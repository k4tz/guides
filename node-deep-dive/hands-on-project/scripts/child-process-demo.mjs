import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync(process.execPath, ['-e', 'console.log(JSON.stringify({pid:process.pid, role:"child"}))']);
console.log(stdout.trim());
