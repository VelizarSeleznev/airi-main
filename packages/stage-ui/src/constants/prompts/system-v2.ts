import type { SystemMessage } from '@xsai/shared-chat'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../emotions'

function message(prefix: string, suffix: string) {
  return {
    role: 'system',
    content: [
      prefix,
      EMOTION_VALUES
        .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
        .join('\n'),
      'When motion clips are available, you may emit `<|ACT {"motion":"MOTION_NAME"}|>` to trigger a VRM body animation. Use the configured motion name exactly as provided by the current AIRI setup.',
      suffix,
    ].join('\n\n'),
  } satisfies SystemMessage
}

export default message
