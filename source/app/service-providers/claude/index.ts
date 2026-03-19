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

/**
 * Represents a single message in the conversation history.
 */
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * The conversation store keeps track of the chat history for the current
 * session. It is kept in-memory only and not persisted to disk.
 */
class ConversationStore {
  private _messages: ConversationMessage[] = []

  addMessage (role: 'user' | 'assistant', content: string): void {
    this._messages.push({ role, content, timestamp: Date.now() })
  }

  getMessages (): ConversationMessage[] {
    return structuredClone(this._messages)
  }

  clear (): void {
    this._messages = []
  }
}

export default class ClaudeProvider extends ProviderContract {
  private _process: ChildProcess | undefined
  private _sessionId: string | undefined
  private readonly _store: ConversationStore

  constructor (private readonly _logger: LogProvider) {
    super()
    this._process = undefined
    this._sessionId = undefined
    this._store = new ConversationStore()

    ipcMain.handle('claude-provider', async (event, message) => {
      const { command, payload } = message

      if (command === 'send-message') {
        const { text, documentContent, selectionText } = payload as {
          text: string
          documentContent?: string
          selectionText?: string
        }
        await this.sendMessage(text, documentContent, selectionText)
      } else if (command === 'stop') {
        this.stop()
      } else if (command === 'clear') {
        this._store.clear()
        this._sessionId = undefined
      } else if (command === 'load-history') {
        return this._store.getMessages()
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

    if (documentContent !== undefined && documentContent.length > 0) {
      parts.push(`\nCurrent document:\n${documentContent}`)
    }

    if (selectionText !== undefined && selectionText.length > 0) {
      parts.push(`\nSelected text:\n${selectionText}`)
    }

    const prompt = parts.join('\n')

    // Store the user message
    this._store.addMessage('user', userMessage)

    // Build the CLI arguments
    const args: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence'
    ]

    if (this._sessionId !== undefined) {
      args.push('--resume', this._sessionId)
    }

    args.push(
      '--append-system-prompt',
      'You are assisting a user in Zettlr, a markdown editor for academic writing and Zettelkasten note-taking.'
    )

    this._logger.info('[Claude Provider] Spawning Claude CLI subprocess')

    try {
      this._process = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this._logger.error(`[Claude Provider] Failed to spawn Claude CLI: ${message}`, err)
      broadcastIpcMessage('claude-provider', 'stream-end', { error: message })
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

          // Capture session ID from the stream
          if (parsed.session_id !== undefined && typeof parsed.session_id === 'string') {
            this._sessionId = parsed.session_id
          }

          // Extract text deltas from content block delta events
          if (
            parsed.type === 'content_block_delta' &&
            parsed.delta?.type === 'text_delta' &&
            typeof parsed.delta.text === 'string'
          ) {
            assistantContent += parsed.delta.text
            broadcastIpcMessage('claude-provider', 'stream-chunk', parsed.delta.text)
          }

          // Detect end of message
          if (parsed.type === 'message_stop') {
            this._store.addMessage('assistant', assistantContent)
            broadcastIpcMessage('claude-provider', 'stream-end', { error: null })
          }
        } catch (err: unknown) {
          // Skip lines that are not valid JSON
          this._logger.verbose(`[Claude Provider] Skipping non-JSON line: ${line.substring(0, 100)}`)
        }
      }
    })

    this._process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      this._logger.verbose(`[Claude Provider] stderr: ${text.substring(0, 500)}`)
    })

    this._process.on('error', (err: Error) => {
      this._logger.error(`[Claude Provider] Process error: ${err.message}`, err)
      broadcastIpcMessage('claude-provider', 'stream-end', { error: err.message })
      this._process = undefined
    })

    this._process.on('close', (code: number | null) => {
      this._logger.info(`[Claude Provider] Process exited with code ${String(code)}`)

      // If the process closes without having sent a message_stop event,
      // we still need to finalize the assistant message and notify the renderer
      if (assistantContent.length > 0) {
        // The message_stop handler may have already stored the message;
        // only add it if the store doesn't already end with this content
        const messages = this._store.getMessages()
        const lastMsg = messages[messages.length - 1]
        if (lastMsg === undefined || lastMsg.role !== 'assistant' || lastMsg.content !== assistantContent) {
          this._store.addMessage('assistant', assistantContent)
        }
      }

      // Process any remaining data in the line buffer
      if (lineBuffer.trim().length > 0) {
        try {
          const parsed = JSON.parse(lineBuffer)
          if (
            parsed.type === 'content_block_delta' &&
            parsed.delta?.type === 'text_delta' &&
            typeof parsed.delta.text === 'string'
          ) {
            broadcastIpcMessage('claude-provider', 'stream-chunk', parsed.delta.text)
          }
        } catch {
          // Ignore trailing non-JSON data
        }
      }

      broadcastIpcMessage('claude-provider', 'stream-end', { error: code !== 0 ? `Process exited with code ${String(code)}` : null })
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
