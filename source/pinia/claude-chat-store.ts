/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        useClaudeChatStore
 * CVM-Role:        Model
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This model manages Claude chat state including messages,
 *                  streaming status, and session history.
 *
 * END HEADER
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const ipcRenderer = window.ipc

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface AuthStatus {
  loggedIn: boolean
  email?: string
  orgName?: string
  subscriptionType?: string
  authMethod?: string
  loginInProgress?: boolean
}

export type ClaudePermissionMode = 'default' | 'plan' | 'auto' | 'acceptEdits'

export interface ClaudeSettings {
  permissionMode: ClaudePermissionMode
  model: string
  allowedTools: string[]
  disallowedTools: string[]
  additionalDirs: string[]
}

export const useClaudeChatStore = defineStore('claude-chat', () => {
  const messages = ref<ClaudeMessage[]>([])
  const isStreaming = ref(false)
  const includeDocument = ref(false)
  const currentSessionId = ref<string | null>(null)
  const currentDocPath = ref<string | null>(null)
  const authStatus = ref<AuthStatus | null>(null)
  const settings = ref<ClaudeSettings>({
    permissionMode: 'plan',
    model: '',
    allowedTools: [],
    disallowedTools: [],
    additionalDirs: []
  })

  /**
   * Computed display name for the current document, extracted from its path.
   * Returns null when no document is associated with the conversation.
   */
  const currentDocTitle = computed<string | null>(() => {
    if (currentDocPath.value == null) {
      return null
    }

    const parts = currentDocPath.value.split('/')
    return parts[parts.length - 1] ?? null
  })

  /**
   * Sends a user message to Claude via IPC and begins streaming.
   *
   * @param   {string}  message     The user's message text
   * @param   {string}  docContent  Optional document content to include
   * @param   {string}  selection   Optional selected text to include
   */
  function sendMessage (message: string, docContent?: string, selection?: string): void {
    const userMessage: ClaudeMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now()
    }

    messages.value.push(userMessage)
    isStreaming.value = true

    ipcRenderer.invoke('claude-provider', {
      command: 'send-message',
      payload: {
        message,
        docContent,
        selection,
        sessionId: currentSessionId.value
      }
    })
      .catch(err => console.error(err))
  }

  /**
   * Appends a streamed text chunk to the last assistant message, creating one
   * if the last message is not from the assistant.
   *
   * @param   {string}  text  The text chunk to append
   */
  function appendChunk (text: string): void {
    const last = messages.value[messages.value.length - 1]
    if (last !== undefined && last.role === 'assistant') {
      last.content += text
    } else {
      messages.value.push({
        role: 'assistant',
        content: text,
        timestamp: Date.now()
      })
    }
  }

  /**
   * Marks the current stream as complete and optionally stores the session ID.
   *
   * @param   {string}  sessionId  Optional session ID returned from the backend
   */
  function finalizeMessage (sessionId?: string): void {
    isStreaming.value = false
    if (sessionId !== undefined) {
      currentSessionId.value = sessionId
    }
  }

  /**
   * Clears all messages and resets the session, notifying the backend via IPC.
   */
  function clearMessages (): void {
    messages.value = []
    currentSessionId.value = null

    ipcRenderer.invoke('claude-provider', {
      command: 'clear',
      payload: { docPath: currentDocPath.value }
    })
      .catch(err => console.error(err))
  }

  /**
   * Loads conversation history for the given document path from the backend.
   *
   * @param   {string}  docPath  The absolute path of the document
   */
  function loadHistory (docPath: string): void {
    currentDocPath.value = docPath

    ipcRenderer.invoke('claude-provider', {
      command: 'load-history',
      payload: { docPath }
    })
      .catch(err => console.error(err))
  }

  /**
   * Bulk-sets messages from loaded history and optionally restores the session.
   *
   * @param   {ClaudeMessage[]}  newMessages  The messages to set
   * @param   {string}           sessionId    Optional session ID to restore
   */
  function setMessages (newMessages: ClaudeMessage[], sessionId?: string): void {
    messages.value = newMessages
    if (sessionId !== undefined) {
      currentSessionId.value = sessionId
    }
  }

  /**
   * Stops the current generation and sets streaming to false.
   */
  function stopGeneration (): void {
    isStreaming.value = false

    ipcRenderer.invoke('claude-provider', {
      command: 'stop',
      payload: { sessionId: currentSessionId.value }
    })
      .catch(err => console.error(err))
  }

  /**
   * Explicitly saves the current conversation history to disk.
   */
  function saveCurrentHistory (): void {
    if (currentDocPath.value == null || messages.value.length === 0) {
      return
    }

    ipcRenderer.invoke('claude-provider', {
      command: 'save-history',
      payload: {
        docPath: currentDocPath.value,
        messages: messages.value,
        sessionId: currentSessionId.value
      }
    })
      .catch(err => console.error(err))
  }

  /**
   * Requests the backend to check the current Claude authentication status.
   * The result will arrive asynchronously via the 'auth-status' IPC event.
   */
  function checkAuth (): void {
    ipcRenderer.invoke('claude-provider', {
      command: 'check-auth',
      payload: {}
    })
      .catch(err => console.error(err))
  }

  /**
   * Launches the interactive Claude login flow via the backend.
   * The result will arrive asynchronously via the 'auth-status' IPC event.
   */
  function login (): void {
    ipcRenderer.invoke('claude-provider', {
      command: 'login',
      payload: {}
    })
      .catch(err => console.error(err))
  }

  /**
   * Loads settings from the backend and updates the local state.
   */
  function loadSettings (): void {
    ipcRenderer.invoke('claude-provider', {
      command: 'get-settings',
      payload: {}
    })
      .then((result: ClaudeSettings) => {
        if (result != null) {
          settings.value = result
        }
      })
      .catch(err => console.error(err))
  }

  /**
   * Sends a partial settings update to the backend and syncs the local state.
   *
   * @param   {Partial<ClaudeSettings>}  partial  The settings fields to update
   */
  function updateSettings (partial: Partial<ClaudeSettings>): void {
    ipcRenderer.invoke('claude-provider', {
      command: 'update-settings',
      payload: partial
    })
      .then((result: ClaudeSettings) => {
        if (result != null) {
          settings.value = result
        }
      })
      .catch(err => console.error(err))
  }

  /**
   * Inserts the given text into the active document at the cursor position
   * by routing through the Claude provider IPC channel.
   *
   * @param   {string}  text  The text to insert into the editor
   */
  function insertIntoDocument (text: string): void {
    ipcRenderer.invoke('claude-provider', {
      command: 'insert-text',
      payload: { text }
    })
      .catch(err => console.error(err))
  }

  const canUndo = ref(false)

  /**
   * Reverts the last Claude write operation on the active document.
   */
  function undoWrite (): void {
    ipcRenderer.invoke('claude-provider', {
      command: 'undo-write',
      payload: {}
    })
      .catch(err => console.error(err))
  }

  // Load settings on store initialization
  loadSettings()

  // Listen to streamed chunks and other events from the backend
  ipcRenderer.on('claude-chat', (event, command: string, payload: any) => {
    if (command === 'chunk') {
      appendChunk(payload as string)
    } else if (command === 'end') {
      finalizeMessage(payload?.sessionId as string | undefined)
      canUndo.value = true
    } else if (command === 'history-loaded') {
      const { messages: loadedMessages, sessionId } = payload as {
        messages: ClaudeMessage[]
        sessionId?: string
      }
      setMessages(loadedMessages, sessionId)
    } else if (command === 'auth-status') {
      authStatus.value = payload as AuthStatus
    } else if (command === 'undo-complete') {
      canUndo.value = false
    } else if (command === 'active-doc-changed') {
      const { path: docPath } = payload as { path: string, title: string }
      currentDocPath.value = docPath
    }
  })

  return {
    messages,
    isStreaming,
    includeDocument,
    currentSessionId,
    currentDocPath,
    currentDocTitle,
    authStatus,
    settings,
    sendMessage,
    appendChunk,
    finalizeMessage,
    clearMessages,
    loadHistory,
    setMessages,
    saveCurrentHistory,
    stopGeneration,
    checkAuth,
    login,
    loadSettings,
    updateSettings,
    insertIntoDocument,
    canUndo,
    undoWrite
  }
})
