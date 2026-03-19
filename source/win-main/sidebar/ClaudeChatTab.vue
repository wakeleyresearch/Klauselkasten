<template>
  <div role="tabpanel" class="claude-chat-tab">
    <!-- Header controls -->
    <div class="claude-chat-header">
      <div class="claude-chat-title-row">
        <h1>Claude</h1>
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
        <div class="claude-chat-message-role">
          {{ msg.role === 'user' ? userLabel : assistantLabel }}
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
import { ref, watch, nextTick, computed } from 'vue'
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
const emptyMessage = trans('Ask Claude anything about your writing.')
const placeholderText = trans('Type a message... (Enter to send, Shift+Enter for newline)')
const settingsLabel = trans('Settings')
const permissionModeLabel = trans('Permission mode')
const modelLabel = trans('Model')

const messages = computed(() => claudeChatStore.messages)
const isStreaming = computed(() => claudeChatStore.isStreaming)

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
      align-items: center;
      justify-content: space-between;
    }

    h1 {
      font-size: 16px;
      margin: 10px 0 5px 0;
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

      .claude-chat-message-role {
        font-size: 11px;
        font-weight: bold;
        margin-bottom: 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
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
}

@keyframes claude-dots-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
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

    .claude-chat-input-area textarea {
      border-color: rgba(255, 255, 255, 0.2);
    }
  }
}
</style>
