/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        ConversationStore
 * CVM-Role:        Service Provider
 * Maintainer:      Shez
 * License:         GNU GPL v3
 *
 * Description:     Manages per-document Claude chat conversation persistence.
 *                  Conversations are stored as JSON files in the user data
 *                  directory, keyed by a SHA-256 hash of the document's
 *                  absolute path.
 *
 * END HEADER
 */

import path from 'path'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { app } from 'electron'
import type { ClaudeMessage, ClaudeConversationFile } from './types'

/**
 * ConversationStore manages the persistence of Claude chat conversations on a
 * per-document basis. Each document's conversation is stored as a JSON file
 * named after the SHA-256 hash of the document's absolute path.
 */
export default class ConversationStore {
  private readonly _conversationsDir: string
  private _dirEnsured: boolean

  constructor () {
    this._conversationsDir = path.join(app.getPath('userData'), 'conversations')
    this._dirEnsured = false
  }

  /**
   * Ensures the conversations directory exists, creating it if necessary.
   * This is called lazily on first use rather than at construction time.
   */
  private async _ensureDir (): Promise<void> {
    if (this._dirEnsured) {
      return
    }

    await fs.mkdir(this._conversationsDir, { recursive: true })
    this._dirEnsured = true
  }

  /**
   * Computes the SHA-256 hash of a document path to use as the conversation
   * filename.
   *
   * @param   {string}  docPath  The absolute path to the document
   * @return  {string}           The hex-encoded SHA-256 hash
   */
  private _hashPath (docPath: string): string {
    return createHash('sha256').update(docPath).digest('hex')
  }

  /**
   * Returns the full filesystem path to the conversation file for a given
   * document.
   *
   * @param   {string}  docPath  The absolute path to the document
   * @return  {string}           The path to the conversation JSON file
   */
  private _filePath (docPath: string): string {
    return path.join(this._conversationsDir, `${this._hashPath(docPath)}.json`)
  }

  /**
   * Loads the conversation history for a given document. Returns null if no
   * conversation has been persisted yet.
   *
   * @param   {string}                              docPath  The absolute path to the document
   * @return  {Promise<ClaudeConversationFile|null>}          The conversation data, or null
   */
  async load (docPath: string): Promise<ClaudeConversationFile | null> {
    await this._ensureDir()

    const filePath = this._filePath(docPath)

    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const data: ClaudeConversationFile = JSON.parse(raw)
      return data
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  /**
   * Saves a conversation to disk for a given document. Creates the file if it
   * does not yet exist, or overwrites it if it does.
   *
   * @param   {string}          docPath    The absolute path to the document
   * @param   {ClaudeMessage[]} messages   The full list of messages to persist
   * @param   {string|null}     sessionId  The current Anthropic session ID, if any
   */
  async save (docPath: string, messages: ClaudeMessage[], sessionId: string | null): Promise<void> {
    await this._ensureDir()

    const data: ClaudeConversationFile = {
      documentPath: docPath,
      documentTitle: path.basename(docPath),
      sessionId,
      messages,
      lastAccessed: Date.now()
    }

    const filePath = this._filePath(docPath)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  /**
   * Clears the persisted conversation for a given document by removing its
   * conversation file from disk.
   *
   * @param   {string}         docPath  The absolute path to the document
   * @return  {Promise<void>}
   */
  async clear (docPath: string): Promise<void> {
    await this._ensureDir()

    const filePath = this._filePath(docPath)

    try {
      await fs.unlink(filePath)
    } catch (err: any) {
      // If the file doesn't exist, that's fine -- nothing to clear
      if (err.code !== 'ENOENT') {
        throw err
      }
    }
  }

  /**
   * Retrieves the session ID for a given document's conversation. Returns null
   * if no conversation exists or if no session ID has been set.
   *
   * @param   {string}                docPath  The absolute path to the document
   * @return  {Promise<string|null>}            The session ID, or null
   */
  async getSessionId (docPath: string): Promise<string | null> {
    const conversation = await this.load(docPath)

    if (conversation === null) {
      return null
    }

    return conversation.sessionId
  }
}
