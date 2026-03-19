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
 *                  and forwards text chunks to the renderer via IPC.  It also
 *                  tracks the active document so that document content can be
 *                  automatically included in prompts and conversation history
 *                  can be loaded per-document.
 *
 * END HEADER
 */

import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { ipcMain } from 'electron'
import broadcastIpcMessage from '@common/util/broadcast-ipc-message'
import ProviderContract from '../provider-contract'
import type LogProvider from '../log'
import type DocumentManager from '../documents'
import type { DocumentsUpdateContext } from '../documents'
import { DP_EVENTS } from '@dts/common/documents'
import ConversationStore from './conversation-store'
import type { ClaudeMessage, ClaudeSettings } from './types'
import { checkAuthStatus, type AuthStatus } from './auth'

export default class ClaudeProvider extends ProviderContract {
  private _process: ChildProcess | undefined
  private _sessionId: string | undefined
  private readonly _store: ConversationStore
  private _currentDocPath: string | undefined
  private _activeDocPath: string | undefined
  private _authStatus: AuthStatus = { loggedIn: false }
  private _settings: ClaudeSettings

  constructor (
    private readonly _logger: LogProvider,
    private readonly _documents: DocumentManager
  ) {
    super()
    this._process = undefined
    this._sessionId = undefined
    this._store = new ConversationStore()
    this._settings = {
      permissionMode: 'plan',
      model: '',
      allowedTools: [],
      disallowedTools: [],
      additionalDirs: []
    }

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
      } else if (command === 'save-history') {
        const { docPath, messages, sessionId } = payload as {
          docPath: string
          messages: ClaudeMessage[]
          sessionId?: string | null
        }
        if (docPath != null && messages != null) {
          await this._store.save(docPath, messages, sessionId ?? null)
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
        } else {
          // No conversation found -- broadcast empty history so the renderer
          // clears any stale messages from the previous document.
          this._sessionId = undefined
          broadcastIpcMessage('claude-chat', 'history-loaded', {
            messages: [],
            sessionId: undefined
          })
        }
        return conversation?.messages ?? []
      } else if (command === 'get-active-doc-info') {
        return this._getActiveDocInfo()
      } else if (command === 'check-auth') {
        const status = await checkAuthStatus()
        this._authStatus = status
        broadcastIpcMessage('claude-chat', 'auth-status', status)
        return status
      } else if (command === 'login') {
        await this._launchLogin()
      } else if (command === 'get-settings') {
        return { ...this._settings }
      } else if (command === 'update-settings') {
        const partial = payload as Partial<ClaudeSettings>
        if (partial.permissionMode != null) {
          this._settings.permissionMode = partial.permissionMode
        }
        if (partial.model != null) {
          this._settings.model = partial.model
        }
        if (partial.allowedTools != null) {
          this._settings.allowedTools = partial.allowedTools
        }
        if (partial.disallowedTools != null) {
          this._settings.disallowedTools = partial.disallowedTools
        }
        if (partial.additionalDirs != null) {
          this._settings.additionalDirs = partial.additionalDirs
        }
        this._logger.info(`[Claude Provider] Settings updated: ${JSON.stringify(this._settings)}`)
        return { ...this._settings }
      }
    })
  }

  async boot (): Promise<void> {
    this._logger.verbose('Claude provider booting up ...')

    // Check auth status on startup and broadcast to renderer
    try {
      this._authStatus = await checkAuthStatus()
      this._logger.info(`[Claude Provider] Auth status: loggedIn=${String(this._authStatus.loggedIn)}, email=${this._authStatus.email ?? 'N/A'}`)
      broadcastIpcMessage('claude-chat', 'auth-status', this._authStatus)
    } catch (err: unknown) {
      this._logger.error('[Claude Provider] Failed to check auth status on boot', err)
      this._authStatus = { loggedIn: false }
      broadcastIpcMessage('claude-chat', 'auth-status', this._authStatus)
    }

    // Listen for active file changes from the DocumentManager so we can
    // automatically track which document the user is working on and load
    // the corresponding conversation history.
    this._documents.on(DP_EVENTS.ACTIVE_FILE, (ctx: DocumentsUpdateContext) => {
      const filePath = ctx.filePath
      if (filePath == null) {
        return
      }

      // Nothing to do if the active document hasn't actually changed
      if (filePath === this._activeDocPath) {
        return
      }

      this._activeDocPath = filePath
      this._currentDocPath = filePath

      this._logger.info(`[Claude Provider] Active document changed: ${filePath}`)

      // Load conversation history for the newly active document and
      // broadcast it to the renderer so the chat sidebar updates.
      this._store.load(filePath)
        .then(conversation => {
          if (conversation != null) {
            this._sessionId = conversation.sessionId ?? undefined
            broadcastIpcMessage('claude-chat', 'history-loaded', {
              messages: conversation.messages,
              sessionId: conversation.sessionId
            })
          } else {
            // No conversation yet -- clear the chat in the renderer
            this._sessionId = undefined
            broadcastIpcMessage('claude-chat', 'history-loaded', {
              messages: [],
              sessionId: null
            })
          }

          // Always notify the renderer of the active doc change
          broadcastIpcMessage('claude-chat', 'active-doc-changed', {
            path: filePath,
            title: path.basename(filePath)
          })
        })
        .catch(err => {
          this._logger.error('[Claude Provider] Failed to load conversation for active doc', err)
        })
    })
  }

  async shutdown (): Promise<void> {
    this._logger.verbose('Claude provider shutting down ...')
    this.stop()
  }

  /**
   * Launches an interactive login flow by opening a terminal emulator with
   * `claude auth login`. After the terminal closes, re-checks auth status
   * and broadcasts the result.
   */
  private async _launchLogin (): Promise<void> {
    this._logger.info('[Claude Provider] Launching Claude auth login in terminal')
    broadcastIpcMessage('claude-chat', 'auth-status', { ...this._authStatus, loginInProgress: true })

    return await new Promise<void>((resolve) => {
      let loginProc
      try {
        loginProc = spawn('x-terminal-emulator', ['-e', '/home/s/.local/bin/claude', 'auth', 'login'], {
          stdio: 'ignore',
          cwd: process.env.HOME ?? '/tmp',
          env: { ...process.env },
          detached: true
        })
      } catch {
        // Fallback to gnome-terminal
        try {
          loginProc = spawn('gnome-terminal', ['--', '/home/s/.local/bin/claude', 'auth', 'login'], {
            stdio: 'ignore',
            cwd: process.env.HOME ?? '/tmp',
            env: { ...process.env },
            detached: true
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          this._logger.error(`[Claude Provider] Failed to launch login terminal: ${message}`, err)
          broadcastIpcMessage('claude-chat', 'auth-status', { ...this._authStatus, loginInProgress: false })
          resolve()
          return
        }
      }

      loginProc.on('error', (err: Error) => {
        this._logger.error(`[Claude Provider] Login terminal error: ${err.message}`, err)
        broadcastIpcMessage('claude-chat', 'auth-status', { ...this._authStatus, loginInProgress: false })
        resolve()
      })

      loginProc.on('close', () => {
        this._logger.info('[Claude Provider] Login terminal closed, re-checking auth status')
        checkAuthStatus()
          .then(status => {
            this._authStatus = status
            broadcastIpcMessage('claude-chat', 'auth-status', status)
          })
          .catch(() => {
            broadcastIpcMessage('claude-chat', 'auth-status', { loggedIn: false })
          })
          .finally(() => { resolve() })
      })
    })
  }

  /**
   * Returns the content of the currently active document by reading it from
   * the DocumentManager's in-memory document buffer.  Returns null if no
   * document is active or the document has not been loaded into memory yet.
   *
   * @return  {string|null}  The document content, or null
   */
  getActiveDocumentContent (): string | null {
    if (this._activeDocPath == null) {
      return null
    }

    // The DocumentManager keeps loaded documents in a private `documents`
    // array.  We can access document content through its public
    // `getDocument()` method, but that is async and will load the file if
    // it is not already loaded.  Instead, we use the synchronous approach:
    // ask the DocumentManager for the document via getDocument, which
    // returns a promise.  Since we need a synchronous result here, we
    // return null and let the caller use the async variant if needed.
    //
    // For the sendMessage() flow we call the async version instead.
    return null
  }

  /**
   * Async helper that reads the active document content from the
   * DocumentManager.
   *
   * @return  {Promise<string|null>}  The document content, or null
   */
  private async _getActiveDocumentContentAsync (): Promise<string | null> {
    if (this._activeDocPath == null) {
      return null
    }

    try {
      const doc = await this._documents.getDocument(this._activeDocPath)
      return doc.content
    } catch (err: unknown) {
      this._logger.verbose(`[Claude Provider] Could not read active document: ${err instanceof Error ? err.message : 'unknown'}`)
      return null
    }
  }

  /**
   * Returns path and title information for the currently active document.
   *
   * @return  {{ path: string, title: string } | null}  Active doc info or null
   */
  private _getActiveDocInfo (): { path: string, title: string } | null {
    if (this._activeDocPath == null) {
      return null
    }

    return {
      path: this._activeDocPath,
      title: path.basename(this._activeDocPath)
    }
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
    // Gate: require authentication before sending messages
    if (!this._authStatus.loggedIn) {
      this._logger.warning('[Claude Provider] Cannot send message: not authenticated')
      broadcastIpcMessage('claude-chat', 'end', {
        error: 'Not authenticated. Please sign in to Claude first.',
        sessionId: this._sessionId
      })
      return
    }

    // If no explicit document content was provided but we have an active
    // document, automatically read its content and include it.
    if ((documentContent == null || documentContent.length === 0) && this._activeDocPath != null) {
      const autoContent = await this._getActiveDocumentContentAsync()
      if (autoContent != null) {
        documentContent = autoContent
      }
    }

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

    // Apply settings to CLI arguments
    if (this._settings.permissionMode.length > 0) {
      args.push('--permission-mode', this._settings.permissionMode)
    }

    if (this._settings.model.length > 0) {
      args.push('--model', this._settings.model)
    }

    if (this._settings.allowedTools.length > 0) {
      args.push('--allowedTools', ...this._settings.allowedTools)
    }

    if (this._settings.disallowedTools.length > 0) {
      args.push('--disallowed-tools', ...this._settings.disallowedTools)
    }

    if (this._settings.additionalDirs.length > 0) {
      args.push('--add-dir', ...this._settings.additionalDirs)
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
