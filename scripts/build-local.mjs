import { spawn } from 'node:child_process'

const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
    .filter(Boolean)
    .join(' '),
}

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit',
  shell: false,
  env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
