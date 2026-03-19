/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Claude Chat Types
 * CVM-Role:        Types
 * Maintainer:      Swarnim Arun
 * License:         GNU GPL v3
 *
 * Description:     Type definitions and IPC channel constants for the Claude
 *                  chat sidebar integration.
 *
 * END HEADER
 */

// IPC channel name constants
export const CLAUDE_SEND = 'claude-send'
export const CLAUDE_STREAM_CHUNK = 'claude-stream-chunk'
export const CLAUDE_STREAM_END = 'claude-stream-end'
export const CLAUDE_STOP = 'claude-stop'
export const CLAUDE_CLEAR = 'claude-clear'
export const CLAUDE_LOAD_HISTORY = 'claude-load-history'
export const CLAUDE_HISTORY_LOADED = 'claude-history-loaded'

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ClaudeChatState {
  messages: ClaudeMessage[]
  isStreaming: boolean
  currentSessionId: string | null
  currentDocPath: string | null
  includeDocument: boolean
}

export interface ClaudeStreamChunk {
  type: 'text_delta' | 'stream_end' | 'error'
  text?: string
  error?: string
  sessionId?: string
}

export interface ClaudeConversationFile {
  documentPath: string
  documentTitle: string
  sessionId: string | null
  messages: ClaudeMessage[]
  lastAccessed: number
}

export type ClaudePermissionMode = 'default' | 'plan' | 'auto' | 'acceptEdits'

export interface ClaudeSettings {
  permissionMode: ClaudePermissionMode
  model: string  // 'opus' | 'sonnet' | 'haiku' or empty for default
  allowedTools: string[]
  disallowedTools: string[]
  additionalDirs: string[]
}
