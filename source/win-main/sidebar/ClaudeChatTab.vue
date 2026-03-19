<template>
  <div role="tabpanel" class="claude-chat-tab">
    <!-- Auth panel: shown when not authenticated -->
    <template v-if="authStatus == null || !authStatus.loggedIn">
      <div class="claude-chat-header">
        <h1>Claude</h1>
      </div>
      <div class="claude-chat-auth-panel">
        <div class="claude-chat-auth-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2>{{ signInTitle }}</h2>
        <p class="claude-chat-auth-desc">{{ signInDesc }}</p>
        <button
          class="claude-chat-btn claude-chat-btn-signin"
          v-bind:disabled="loginInProgress"
          v-on:click="handleLogin"
        >
          <template v-if="loginInProgress">
            <span class="claude-chat-spinner"></span>
            {{ signingInLabel }}
          </template>
          <template v-else>
            {{ signInLabel }}
          </template>
        </button>
        <button
          class="claude-chat-btn claude-chat-btn-retry"
          v-on:click="handleCheckAuth"
        >
          {{ checkStatusLabel }}
        </button>
      </div>
    </template>

    <!-- Chat interface: shown when authenticated -->
    <template v-else>
      <!-- Header controls -->
      <div class="claude-chat-header">
        <div class="claude-chat-title-row">
          <div>
            <h1>Claude</h1>
            <p v-if="authStatus.email != null" class="claude-chat-email">{{ authStatus.email }}</p>
            <p v-if="currentDocTitle != null" class="claude-chat-doc-title">{{ currentDocTitle }}</p>
          </div>
          <button
            class="claude-chat-btn claude-chat-btn-gear"
            v-bind:class="{ active: showSettings }"
            v-on:click="toggleSettings"
            v-bind:title="settingsLabel"
          >
            &#9881;
          </button>
        </div>
        <div class="claude-chat-controls">
          <label class="claude-chat-toggle">
            <input
              type="checkbox"
              v-model="includeDocument"
            >
            {{ includeDocumentLabel }}
          </label>
          <button
            v-if="isStreaming"
            class="claude-chat-btn claude-chat-btn-stop"
            v-on:click="stopStreaming"
          >
            {{ stopLabel }}
          </button>
          <button
            class="claude-chat-btn"
            v-on:click="clearConversation"
          >
            {{ clearLabel }}
          </button>
        </div>

        <!-- Inline settings panel -->
        <div v-if="showSettings" class="claude-chat-settings">
          <div class="claude-chat-setting-row">
            <label>{{ permissionModeLabel }}</label>
            <select v-model="selectedPermissionMode" v-on:change="onSettingsChange">
              <option value="default">Default</option>
              <option value="plan">Plan</option>
              <option value="auto">Auto</option>
              <option value="acceptEdits">Accept Edits</option>
            </select>
          </div>
          <div class="claude-chat-setting-row">
            <label>{{ modelLabel }}</label>
            <select v-model="selectedModel" v-on:change="onSettingsChange">
              <option value="">Default</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Message list -->
      <div
        ref="messageContainer"
        class="claude-chat-messages"
      >
        <div v-if="messages.length === 0" class="claude-chat-empty">
          {{ emptyMessage }}
        </div>
        <div
          v-for="(msg, idx) in messages"
          v-bind:key="idx"
          v-bind:class="['claude-chat-message', 'claude-chat-message-' + msg.role]"
        >
          <div class="claude-chat-message-header">
            <div class="claude-chat-message-role">
              {{ msg.role === 'user' ? userLabel : assistantLabel }}
            </div>
            <div
              v-if="msg.role === 'assistant'"
              class="claude-chat-message-actions"
            >
              <button
                class="claude-chat-action-btn"
                v-bind:title="insertLabel"
                v-on:click="insertIntoDocument(msg.content)"
              >
                {{ insertLabel }}
              </button>
              <button
                class="claude-chat-action-btn"
                v-bind:title="copyLabel"
                v-on:click="copyToClipboard(msg.content)"
              >
                {{ copyLabel }}
              </button>
            </div>
          </div>
          <div class="claude-chat-message-content">
            {{ msg.content }}
          </div>
        </div>
        <div v-if="isStreaming" class="claude-chat-streaming">
          <span class="claude-chat-dots">...</span>
        </div>
      </div>

      <!-- Input area -->
      <div class="claude-chat-input-area">
        <textarea
          ref="inputArea"
          v-model="inputText"
          v-bind:placeholder="placeholderText"
          v-bind:disabled="isStreaming"
          v-on:keydown="handleKeydown"
          rows="3"
        ></textarea>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        ClaudeChatTab
 * CVM-Role:        View
 * Maintainer:      Wakeley Research
 * License:         GNU GPL v3
 *
 * Description:     This component renders the Claude chat sidebar tab,
 *                  providing a conversational interface to Claude within
 *                  the Zettlr editor.
 *
 * END HEADER
 */

import { trans } from '@common/i18n-renderer'
import { ref, watch, nextTick, computed, onMounted } from 'vue'
import { useClaudeChatStore } from 'source/pinia'

const claudeChatStore = useClaudeChatStore()

const inputText = ref('')
const messageContainer = ref<HTMLDivElement | null>(null)
const inputArea = ref<HTMLTextAreaElement | null>(null)
const showSettings = ref(false)

const includeDocumentLabel = trans('Include document')
const clearLabel = trans('Clear')
const stopLabel = trans('Stop')
const userLabel = trans('User')
const assistantLabel = trans('Claude')
const insertLabel = trans('Insert')
const copyLabel = trans('Copy')
const emptyMessage = trans('Ask Claude anything about your writing.')
const placeholderText = trans('Type a message... (Enter to send, Shift+Enter for newline)')
const signInTitle = trans('Sign in to Claude')
const signInDesc = trans('Authenticate with your Claude account to start chatting.')
const signInLabel = trans('Sign In')
const signingInLabel = trans('Signing in...')
const checkStatusLabel = trans('Check status')
const settingsLabel = trans('Settings')
const permissionModeLabel = trans('Permission mode')
const modelLabel = trans('Model')

const messages = computed(() => claudeChatStore.messages)
const isStreaming = computed(() => claudeChatStore.isStreaming)
const authStatus = computed(() => claudeChatStore.authStatus)
const loginInProgress = computed(() => authStatus.value?.loginInProgress === true)
const currentDocTitle = computed(() => claudeChatStore.currentDocTitle)

const selectedPermissionMode = computed({
  get: () => claudeChatStore.settings.permissionMode,
  set: (value: string) => {
    claudeChatStore.updateSettings({ permissionMode: value as any })
  }
})

const selectedModel = computed({
  get: () => claudeChatStore.settings.model,
  set: (value: string) => {
    claudeChatStore.updateSettings({ model: value })
  }
})

const includeDocument = computed({
  get: () => claudeChatStore.includeDocument,
  set: (value: boolean) => { claudeChatStore.includeDocument = value }
})

// Request auth status check on mount in case the boot broadcast was missed
onMounted(() => {
  if (authStatus.value == null) {
    claudeChatStore.checkAuth()
  }
})

/**
 * Scrolls the message container to the bottom so that the most recent
 * message is always visible.
 */
function scrollToBottom (): void {
  if (messageContainer.value !== null) {
    messageContainer.value.scrollTop = messageContainer.value.scrollHeight
  }
}

// Watch for new messages and streaming state changes to auto-scroll
watch(() => messages.value.length, () => {
  nextTick(scrollToBottom)
})

watch(isStreaming, () => {
  nextTick(scrollToBottom)
})

/**
 * Handles keyboard events in the textarea. Enter sends the message,
 * Shift+Enter inserts a newline.
 *
 * @param   {KeyboardEvent}  event  The keyboard event
 */
function handleKeydown (event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

/**
 * Sends the current input text as a user message via the store.
 */
function sendMessage (): void {
  const text = inputText.value.trim()
  if (text.length === 0) {
    return
  }

  claudeChatStore.sendMessage(text)
  inputText.value = ''

  nextTick(() => {
    if (inputArea.value !== null) {
      inputArea.value.focus()
    }
  })
}

/**
 * Stops the current streaming response.
 */
function stopStreaming (): void {
  claudeChatStore.stopGeneration()
}

/**
 * Clears the conversation history.
 */
function clearConversation (): void {
  claudeChatStore.clearMessages()
}

/**
 * Launches the interactive login flow.
 */
function handleLogin (): void {
  claudeChatStore.login()
}

/**
 * Re-checks auth status (useful after external login).
 */
function handleCheckAuth (): void {
  claudeChatStore.checkAuth()
}

/**
 * Toggles the visibility of the inline settings panel.
 */
function toggleSettings (): void {
  showSettings.value = !showSettings.value
}

/**
 * Called when a settings dropdown value changes. The computed setters
 * handle the actual update, so this is a no-op placeholder for the
 * v-on:change binding.
 */
function onSettingsChange (): void {
  // Updates are handled by computed setters
}

/**
 * Inserts the given text into the active document at the cursor position.
 *
 * @param   {string}  text  The text to insert
 */
function insertIntoDocument (text: string): void {
  claudeChatStore.insertIntoDocument(text)
}

/**
 * Copies the given text to the system clipboard.
 *
 * @param   {string}  text  The text to copy
 */
function copyToClipboard (text: string): void {
  navigator.clipboard.writeText(text).catch(err => console.error(err))
}
</script>

<style lang="less">
.claude-chat-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;

  .claude-chat-header {
    flex-shrink: 0;
    padding-bottom: 5px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    margin-bottom: 5px;

    .claude-chat-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }

    h1 {
      font-size: 16px;
      margin: 10px 0 5px 0;
    }

    .claude-chat-email {
      font-size: 11px;
      color: rgb(120, 120, 120);
      margin: 0 0 2px 0;
      line-height: 1.2;
    }

    .claude-chat-doc-title {
      font-size: 11px;
      color: rgb(100, 100, 100);
      margin: 0 0 4px 0;
      line-height: 1.2;
      font-style: italic;
    }

    .claude-chat-btn-gear {
      font-size: 16px;
      padding: 2px 6px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: inherit;
      opacity: 0.5;
      line-height: 1;
      margin-top: 10px;

      &:hover { opacity: 0.8; }
      &.active { opacity: 1; }
    }

    .claude-chat-settings {
      margin-top: 6px;
      padding: 8px;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      background-color: rgba(0, 0, 0, 0.02);

      .claude-chat-setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        font-size: 12px;

        &:last-child { margin-bottom: 0; }

        label {
          flex-shrink: 0;
          margin-right: 8px;
        }

        select {
          flex-grow: 1;
          max-width: 140px;
          font-size: 12px;
          padding: 2px 4px;
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 3px;
          background-color: transparent;
          color: inherit;
        }
      }
    }

    .claude-chat-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;

      .claude-chat-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        cursor: pointer;
        user-select: none;

        input[type="checkbox"] { cursor: pointer; }
      }

      .claude-chat-btn {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid rgba(0, 0, 0, 0.2);
        background-color: transparent;
        color: inherit;

        &:hover { background-color: rgba(0, 0, 0, 0.05); }
      }

      .claude-chat-btn-stop {
        color: rgb(200, 50, 50);
        border-color: rgb(200, 50, 50);

        &:hover { background-color: rgba(200, 50, 50, 0.1); }
      }
    }
  }

  .claude-chat-messages {
    flex-grow: 1;
    overflow-y: auto;
    padding: 5px 0;

    .claude-chat-empty {
      font-size: 12px;
      color: rgb(120, 120, 120);
      text-align: center;
      padding: 20px 10px;
    }

    .claude-chat-message {
      margin-bottom: 10px;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.4;

      .claude-chat-message-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2px;
      }

      .claude-chat-message-role {
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .claude-chat-message-actions {
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      &:hover .claude-chat-message-actions {
        opacity: 1;
      }

      .claude-chat-action-btn {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        cursor: pointer;
        border: 1px solid rgba(0, 0, 0, 0.15);
        background-color: transparent;
        color: inherit;
        line-height: 1.4;

        &:hover {
          background-color: rgba(0, 0, 0, 0.08);
          border-color: rgba(0, 0, 0, 0.3);
        }
      }

      .claude-chat-message-content {
        white-space: pre-wrap;
        word-break: break-word;
        user-select: text;
        cursor: text;
      }
    }

    .claude-chat-message-user {
      background-color: rgba(0, 100, 200, 0.08);
    }

    .claude-chat-message-assistant {
      background-color: rgba(0, 0, 0, 0.04);
    }

    .claude-chat-streaming {
      padding: 4px 8px;
      font-size: 13px;

      .claude-chat-dots {
        display: inline-block;
        animation: claude-dots-pulse 1.2s ease-in-out infinite;
        color: var(--system-accent-color, rgb(0, 100, 200));
        font-weight: bold;
        letter-spacing: 2px;
      }
    }
  }

  .claude-chat-input-area {
    flex-shrink: 0;
    padding-top: 5px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);

    textarea {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      min-height: 50px;
      max-height: 120px;
      padding: 6px 8px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: 4px;
      background-color: transparent;
      color: inherit;
      outline: none;

      &:focus {
        border-color: var(--system-accent-color, rgb(0, 100, 200));
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }
  }

  .claude-chat-auth-panel {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    text-align: center;
    gap: 12px;

    .claude-chat-auth-icon {
      color: rgb(120, 120, 120);
    }

    h2 {
      font-size: 15px;
      margin: 0;
    }

    .claude-chat-auth-desc {
      font-size: 12px;
      color: rgb(120, 120, 120);
      margin: 0;
      line-height: 1.4;
    }

    .claude-chat-btn-signin {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 13px;
      padding: 6px 20px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid var(--system-accent-color, rgb(0, 100, 200));
      background-color: var(--system-accent-color, rgb(0, 100, 200));
      color: #fff;
      font-weight: 500;

      &:hover:not(:disabled) { opacity: 0.9; }

      &:disabled {
        opacity: 0.7;
        cursor: wait;
      }
    }

    .claude-chat-btn-retry {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid rgba(0, 0, 0, 0.2);
      background-color: transparent;
      color: inherit;

      &:hover { background-color: rgba(0, 0, 0, 0.05); }
    }

    .claude-chat-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: claude-spin 0.8s linear infinite;
    }
  }
}

@keyframes claude-dots-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

@keyframes claude-spin {
  to { transform: rotate(360deg); }
}

body.dark {
  .claude-chat-tab {
    .claude-chat-header {
      border-bottom-color: rgba(255, 255, 255, 0.1);

      .claude-chat-settings {
        border-color: rgba(255, 255, 255, 0.1);
        background-color: rgba(255, 255, 255, 0.04);

        .claude-chat-setting-row select {
          border-color: rgba(255, 255, 255, 0.2);
        }
      }

      .claude-chat-controls {
        .claude-chat-btn {
          border-color: rgba(255, 255, 255, 0.2);

          &:hover { background-color: rgba(255, 255, 255, 0.1); }
        }

        .claude-chat-btn-stop {
          color: rgb(255, 100, 100);
          border-color: rgb(255, 100, 100);

          &:hover { background-color: rgba(255, 100, 100, 0.15); }
        }
      }
    }

    .claude-chat-messages {
      .claude-chat-message-user {
        background-color: rgba(80, 160, 255, 0.12);
      }

      .claude-chat-message-assistant {
        background-color: rgba(255, 255, 255, 0.06);
      }
    }

    .claude-chat-message .claude-chat-action-btn {
      border-color: rgba(255, 255, 255, 0.2);

      &:hover {
        background-color: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.35);
      }
    }

    .claude-chat-input-area textarea {
      border-color: rgba(255, 255, 255, 0.2);
    }

    .claude-chat-auth-panel {
      .claude-chat-btn-retry {
        border-color: rgba(255, 255, 255, 0.2);

        &:hover { background-color: rgba(255, 255, 255, 0.1); }
      }
    }
  }
}
</style>
