import { createQueue } from '@proj-airi/stream-kit'
import { describe, expect, it, vi } from 'vitest'

import { useEmotionsMessageQueue, useMotionsMessageQueue } from './queues'

describe('queues', () => {
  it('parses ACT emotion payloads into the downstream queue', async () => {
    const emotionHandler = vi.fn()
    const emotionsQueue = createQueue({
      handlers: [emotionHandler],
    })
    const queue = useEmotionsMessageQueue(emotionsQueue)

    queue.enqueue('<|ACT {"emotion":{"name":"happy","intensity":0.4}}|>')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(emotionHandler).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        name: 'happy',
        intensity: 0.4,
      },
    }))
  })

  it('parses ACT motion payloads into the downstream queue', async () => {
    const motionHandler = vi.fn()
    const motionsQueue = createQueue({
      handlers: [motionHandler],
    })
    const queue = useMotionsMessageQueue(motionsQueue)

    queue.enqueue('<|ACT {"motion":{"name":"VRMA_03","loop":false}}|>')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(motionHandler).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        name: 'VRMA_03',
        loop: false,
      },
    }))
  })
})
