/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Claude Auth Utilities
 * CVM-Role:        Utility
 * Maintainer:      Wakeley Research
 * License:         GNU GPL v3
 *
 * Description:     Functions for checking Claude CLI authentication status
 *                  and launching the interactive login flow.
 *
 * END HEADER
 */

import { spawn } from 'child_process'

export interface AuthStatus {
  loggedIn: boolean
  email?: string
  orgName?: string
  subscriptionType?: string
  authMethod?: string
}

/**
 * Spawns `claude auth status` and parses the JSON output to determine
 * whether the user is currently authenticated.
 *
 * @return  {Promise<AuthStatus>}  The parsed auth status, or `{ loggedIn: false }` on error
 */
export async function checkAuthStatus (): Promise<AuthStatus> {
  return await new Promise<AuthStatus>((resolve) => {
    let stdout = ''

    let proc
    try {
      proc = spawn('/home/s/.local/bin/claude', ['auth', 'status'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.env.HOME ?? '/tmp',
        env: { ...process.env }
      })
    } catch {
      resolve({ loggedIn: false })
      return
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    proc.stderr?.on('data', () => {
      // Ignore stderr output but consume the stream
    })

    proc.on('error', () => {
      resolve({ loggedIn: false })
    })

    proc.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim())
        resolve({
          loggedIn: parsed.loggedIn === true,
          email: typeof parsed.email === 'string' ? parsed.email : undefined,
          orgName: typeof parsed.orgName === 'string' ? parsed.orgName : undefined,
          subscriptionType: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined,
          authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : undefined
        })
      } catch {
        resolve({ loggedIn: false })
      }
    })
  })
}
