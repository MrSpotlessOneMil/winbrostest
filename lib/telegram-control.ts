const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'

interface SendMessageResult {
  success: boolean
  messageId?: number
  error?: string
}

interface InlineKeyboardButton {
  text: string
  callback_data: string
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

function getControlBotToken(): string | null {
  const token = process.env.TELEGRAM_CONTROL_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_CONTROL_BOT_TOKEN not configured')
    return null
  }
  return token
}

export async function sendControlTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
  replyMarkup?: InlineKeyboardMarkup
): Promise<SendMessageResult> {
  const botToken = getControlBotToken()

  if (!botToken) {
    return { success: false, error: 'Control bot token not configured' }
  }

  if (!chatId) {
    return { success: false, error: 'Chat ID required' }
  }

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }

    if (replyMarkup) {
      payload.reply_markup = replyMarkup
    }

    const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!data.ok) {
      console.error('Telegram control API error:', data)
      return { success: false, error: data.description || 'Telegram API error' }
    }

    return {
      success: true,
      messageId: data.result?.message_id,
    }
  } catch (error) {
    console.error('Error sending Telegram control message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function answerControlCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const botToken = getControlBotToken()
  if (!botToken) return false

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || 'Response received!',
      }),
    })

    const data = await response.json()
    return data.ok === true
  } catch (error) {
    console.error('Error answering control callback query:', error)
    return false
  }
}

export async function editControlMessageReplyMarkup(
  chatId: string,
  messageId: number
): Promise<boolean> {
  const botToken = getControlBotToken()
  if (!botToken) return false

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    })

    const data = await response.json()
    return data.ok === true
  } catch (error) {
    console.error('Error editing control message reply markup:', error)
    return false
  }
}

export function buildControlKeyboard(isDisabled: boolean): InlineKeyboardMarkup {
  if (isDisabled) {
    return {
      inline_keyboard: [[{ text: 'Turn the system back on', callback_data: 'system_on' }]],
    }
  }

  return {
    inline_keyboard: [[{ text: 'Turn the system off', callback_data: 'system_off' }]],
  }
}
