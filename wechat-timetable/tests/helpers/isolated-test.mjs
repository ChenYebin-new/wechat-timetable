import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Session locks deliberately have no reset API. Run fault cases in a new process,
// just as a cold launch creates a new mini-program session.
export function sessionTest(file) {
  return (name, body) => {
    if (process.env.WECHAT_ISOLATED_TEST === name) return test(name, body)
    return test(name, () => new Promise((resolve, reject) => {
      const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
      const env = { ...process.env, WECHAT_ISOLATED_TEST: name }
      // A nested runner must not inherit the parent's internal IPC/reporting mode.
      delete env.NODE_TEST_CONTEXT
      const child = spawn(process.execPath, ['--test', '--disable-warning=ExperimentalWarning', `--test-name-pattern=${pattern}`, fileURLToPath(file)], {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(output)))
    }))
  }
}
