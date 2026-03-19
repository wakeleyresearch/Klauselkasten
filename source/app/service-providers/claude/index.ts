/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        ClaudeProvider
 * CVM-Role:        Service Provider
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This service provider manages a Claude Code CLI subprocess,
 *                  sends user messages to it, parses streaming NDJSON output,
 *                  and forwards text chunks to the renderer via IPC.
 *
 * END HEADER
 */

import { spawn, type ChildProcess } from 'child_process'
import { ipcMain } from 'electron'
import broadcastIpcMessage from '@common/util/broadcast-ipc-message'
import ProviderContract from '../provider-contract'
import type LogProvider from '../log'
import ConversationStore from './conversation-store'
import type { ClaudeMessage } from './types'

export default class ClaudeProvider extends ProviderContract {
  private _process: ChildProcess | undefined
  private _sessionId: string | undefined
  private readonly _store: ConversationStore
  private _currentDocPath: string | undefined

  constructor (private readonly _logger: LogProvider) {
    super()
    this._process = undefined
    this._sessionId = undefined
    this._store = new ConversationStore()

    ipcMain.handle('claude-provider', async (event, message) => {
      const { command, payload } = message

      if (command === 'send-message') {
        const { message: text, docContent, selection, sessionId } = payload as {
          message: string
          docContent?: string
          selection?: string
          sessionId?: string
        }
        if (sessionId != null) {
          this._sessionId = sessionId
        }
        await this.sendMessage(text, docContent, selection)
      } else if (command === 'stop') {
        this.stop()
      } else if (command === 'clear') {
        if (this._currentDocPath !== undefined) {
          await this._store.clear(this._currentDocPath)
        }
        this._sessionId = undefined
      } else if (command === 'insert-text') {
        const { text } = payload as { text: string }
        if (typeof text === 'string' && text.length > 0) {
          broadcastIpcMessage('claude-chat', 'insert-text', { text })
        }
      } else if (command === 'load-history') {
        const { docPath } = payload as { docPath: string }
        this._currentDocPath = docPath
        const conversation = await this._store.load(docPath)
        if (conversation !== null) {
          this._sessionId = conversation.sessionId ?? undefined
          broadcastIpcMessage('claude-chat', 'history-loaded', {
            messages: conversation.messages,
            sessionId: conversation.sessionId
          })
        }
        return conversation?.messages ?? []
      }
    })
  }

  async boot (): Promise<void> {
    this._logger.verbose('Claude provider booting up ...')
  }

  async shutdown (): Promise<void> {
    this._logger.verbose('Claude provider shutting down ...')
    this.stop()
  }

  /**
   * Sends a message to the Claude Code CLI subprocess and streams the response
   * back to the renderer process.
   *
   * @param   {string}  userMessage      The user's message text
   * @param   {string}  documentContent  Optional current document content
   * @param   {string}  selectionText    Optional selected text
   */
  async sendMessage (userMessage: string, documentContent?: string, selectionText?: string): Promise<void> {
    // Build the prompt from the message and optional context
    const parts: string[] = [userMessage]

    if (documentContent != null && documentContent.length > 0) {
      parts.push(`\nCurrent document:\n${documentContent}`)
    }

    if (selectionText != null && selectionText.length > 0) {
      parts.push(`\nSelected text:\n${selectionText}`)
    }

    const prompt = parts.join('\n')

    // Build the CLI arguments
    const args: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages'
    ]

    if (this._sessionId != null) {
      args.push('--resume', this._sessionId)
    }

    args.push(
      '--append-system-prompt',
      'You are assisting a user in Zettlr, a markdown editor for academic writing and Zettelkasten note-taking.'
    )

    this._logger.info(`[Claude Provider] Spawning Claude CLI subprocess with args: ${JSON.stringify(args.map(a => a.length > 50 ? a.substring(0, 50) + '...' : a))}`)

    try {
      this._process = spawn('/home/s/.local/bin/claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.env.HOME ?? '/tmp',
        env: { ...process.env }
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this._logger.error(`[Claude Provider] Failed to spawn Claude CLI: ${message}`, err)
      broadcastIpcMessage('claude-chat', 'end', { error: message, sessionId: this._sessionId })
      return
    }

    let assistantContent = ''
    let lineBuffer = ''

    this._process.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf-8')
      const lines = lineBuffer.split('\n')
      // Keep the last (possibly incomplete) line in the buffer
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue
        }

        try {
          const parsed = JSON.parse(line)

          // Capture session ID from any event that carries it
          if (parsed.session_id !== undefined && typeof parsed.session_id === 'string') {
            this._sessionId = parsed.session_id
          }

          // Handle stream_event wrapper (Claude Code CLI format)
          if (parsed.type === 'stream_event' && parsed.event !== undefined) {
            const event = parsed.event

            // Extract text deltas from content block delta events
            if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'text_delta' &&
              typeof event.delta.text === 'string'
            ) {
              assistantContent += event.delta.text
              broadcastIpcMessage('claude-chat', 'chunk', event.delta.text)
            }

            // Detect end of message
            if (event.type === 'message_stop') {
              broadcastIpcMessage('claude-chat', 'end', {
                error: null,
                sessionId: this._sessionId
              })

              // Persist conversation to disk
              if (this._currentDocPath !== undefined) {
                const docPath = this._currentDocPath
                const sessionId = this._sessionId ?? null
                const content = assistantContent
                this._store.load(docPath)
                  .then(conversation => {
                    const msgs = conversation?.messages ?? []
                    msgs.push(
                      { role: 'user', content: userMessage, timestamp: Date.now() },
                      { role: 'assistant', content, timestamp: Date.now() }
                    )
                    return this._store.save(docPath, msgs, sessionId)
                  })
                  .catch(err => this._logger.error('[Claude Provider] Failed to save conversation', err))
              }
            }
          }

          // Handle result event (final response)
          if (parsed.type === 'result' && parsed.result !== undefined) {
            // If we didn't get streaming chunks, use the final result
            if (assistantContent.length === 0 && typeof parsed.result === 'string') {
              assistantContent = parsed.result
              broadcastIpcMessage('claude-chat', 'chunk', parsed.result)
            }
          }
        } catch (err: unknown) {
          // Skip lines that are not valid JSON
          this._logger.verbose(`[Claude Provider] Skipping non-JSON line: ${line.substring(0, 100)}`)
        }
      }
    })

    this._process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text.length > 0) {
        this._logger.info(`[Claude Provider] stderr: ${text.substring(0, 500)}`)
      }
    })

    this._process.on('error', (err: Error) => {
      this._logger.error(`[Claude Provider] Process error: ${err.message}`, err)
      broadcastIpcMessage('claude-chat', 'end', { error: err.message })
      this._process = undefined
    })

    this._process.on('close', (code: number | null) => {
      this._logger.info(`[Claude Provider] Process exited with code ${String(code)}`)

      // Process any remaining data in the line buffer
      if (lineBuffer.trim().length > 0) {
        try {
          const parsed = JSON.parse(lineBuffer)
          if (
            parsed.type === 'stream_event' &&
            parsed.event?.type === 'content_block_delta' &&
            parsed.event.delta?.type === 'text_delta' &&
            typeof parsed.event.delta.text === 'string'
          ) {
            broadcastIpcMessage('claude-chat', 'chunk', parsed.event.delta.text)
          }
        } catch {
          // Ignore trailing non-JSON data
        }
      }

      broadcastIpcMessage('claude-chat', 'end', {
        error: code !== 0 ? `Process exited with code ${String(code)}` : null,
        sessionId: this._sessionId
      })
      this._process = undefined
    })
  }

  /**
   * Kills the running Claude CLI subprocess, if any.
   */
  stop (): void {
    if (this._process !== undefined) {
      this._logger.info('[Claude Provider] Killing Claude CLI subprocess')
      this._process.kill()
      this._process = undefined
    }
  }
}
