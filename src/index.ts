import { Ratelimit } from '@upstash/ratelimit'
import { NextApiRequest, NextApiResponse, NextApiHandler } from 'next'
import { LRUCache } from 'typescript-lru-cache'
import { z } from 'zod'

const RateLimitOptionsSchema = z.object({
  timeframe: z.number().positive().default(60),
  requestsLimit: z.number().positive().default(5),
  disableLRU: z.boolean().default(false),
  provider: z.enum(['upstash', 'vercelKV']).default('upstash'),
  errorMessage: z.string().optional(),
})

type RateLimitOptions = z.infer<typeof RateLimitOptionsSchema>
type RateLimitState = { remaining: number; reset: number }

export function withRateLimit(
  handler: NextApiHandler,
  getKey: (req: NextApiRequest) => string,
  options: Partial<RateLimitOptions> = {},
): NextApiHandler {
  const { timeframe, requestsLimit, disableLRU, provider, errorMessage } = RateLimitOptionsSchema.parse(options)

  const cache = new LRUCache<string, RateLimitState>({
    maxSize: 500,
    entryExpirationTimeInMS: timeframe * 1000,
  })

  let redisClient
  if (provider === 'upstash') {
    const { UPSTASH_URL, UPSTASH_TOKEN } = process.env
    if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Missing Upstash environment variables')
    const { Redis } = require('@upstash/redis')
    redisClient = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN })
  } else {
    const { kv } = require('@vercel/kv')
    redisClient = kv
  }

  const ratelimit = new Ratelimit({
    redis: redisClient,
    limiter: Ratelimit.slidingWindow(requestsLimit, `${timeframe} s`),
  })

  const defaultErrorMessage = `Too Many Requests. The limit is ${requestsLimit} requests per ${timeframe / 60} minutes.`
  const getErrorMessage = () => errorMessage || defaultErrorMessage

  const handleLimitExceeded = (key: string, res: NextApiResponse) => {
    console.error(`Rate limit exceeded for key: ${key}`)
    return res.status(429).json({ error: getErrorMessage() })
  }

  const updateCacheAndProceed = (
    remaining: number,
    reset: number,
    key: string,
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    const ttl = reset - Date.now()
    if (ttl > 0) cache.set(key, { remaining, reset }, { entryExpirationTimeInMS: ttl })
    return handler(req, res)
  }

  return async (req: NextApiRequest, res: NextApiResponse) => {
    const key = getKey(req)
    if (!key) return res.status(400).json({ error: 'Unable to determine rate limit key' })

    if (!disableLRU) {
      const cachedState = cache.get(key)
      if (cachedState && cachedState.reset > Date.now()) {
        if (cachedState.remaining > 0) {
          return updateCacheAndProceed(cachedState.remaining - 1, cachedState.reset, key, req, res)
        }
        return handleLimitExceeded(key, res)
      }
    }

    try {
      const { success, remaining, reset, pending } = await ratelimit.limit(key)
      if (pending) await pending
      if (!success) return handleLimitExceeded(key, res)
      if (!disableLRU) return updateCacheAndProceed(remaining - 1, reset, key, req, res)
      return handler(req, res)
    } catch (error) {
      return res.status(500).json({ error: 'Internal Server Error' })
    }
  }
}
