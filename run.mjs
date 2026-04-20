import { spawn } from 'node:child_process';

function runNodeTest() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test'], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Tests failed with exit code ${code}.`));
      }
    });
  });
}

const command = process.argv[2] ?? 'test';

if (command === 'test') {
  await runNodeTest();
} else {
  throw new Error(`Unknown run.mjs command: ${command}`);
}
