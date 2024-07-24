<div align="center">
    <img src="https://github.com/woywro/next-api-rate-limit/raw/main/logo.png?raw=true" alt="Logo" width="80" height="80">

  <h3 align="center">next-api-rate-limit</h3>

  <p align="center">
   Cost Efficient Rate Limiting with Redis (KV/Upstash) and LRU Cache
  </p>
</div>

## Overview
This middleware provides rate limiting for Next.js API routes using a <b>combination of an LRU (Least Recently Used) cache and Upstash's Redis-based rate limiting</b>. By leveraging the LRU cache, this solution reduces the number of calls to the Redis store, thereby saving costs and improving performance.

## Features
- Cost-Efficient: Minimizes the usage of Redis calls by caching rate limit states in an LRU cache.
- Flexible Configuration: Allows customization of rate limit parameters, including timeframe and request limit.
- LRU Cache Option: Option to disable the LRU cache if not required.
- Simple Integration: Easy to integrate into existing Next.js API routes.

## Installation

Install the package using one of the following commands:

```
npm install next-api-rate-limit

pnpm install next-api-rate-limit

yarn add next-api-rate-limit
```
## Usage

### Middleware Integration
To use the rate limit middleware, wrap your API route handler with the withRateLimit function.
```ts
import { withRateLimit } from 'next-api-rate-limit';
import { NextApiRequest, NextApiResponse } from 'next';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  // Your API logic here
  res.status(200).json({ message: 'Success' });
};

export default withRateLimit(handler, (req) => req.headers['x-real-ip'] as string, {
  timeframe: 3600, // Timeframe in seconds (1 hour)
  requestsLimit: 100, // Limit of requests within the timeframe
  disableLRU: false, // Optional: Disable LRU cache if set to true
  provider: 'upstash', // Optional: Choose between 'upstash' and 'vercelKV'
  errorMessage: //Optional: Custom error message
});

```

### Configuration
The middleware accepts a configuration object with the following properties:

- timeframe: (number, optional) The timeframe in seconds for the rate limit. Default is 3600s.
- requestsLimit: (number, optional) The maximum number of requests allowed within the timeframe. Default is 100.
- disableLRU: (boolean, optional) Disable the LRU cache if set to true. Default is false.
- provider: (string, optional) Choose between 'upstash' and 'vercelKV'. Default is 'upstash'.
- errorMessage: (string, optional) Custom error message for rate limit exceeded.

### Envs
- For Vercel KV:
```bash
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=
```
- For Upstash:
```bash
UPSTASH_URL=
UPSTASH_TOKEN=
```

### Key Generation
The middleware requires a function to generate a unique key for each request, typically based on the client's IP address or some other identifying information. This key is used to track the request count and apply the rate limiting logic.

Example of key generation using IP address:
```ts
import { NextApiRequest } from 'next';

const getKeyFromIp = (req: NextApiRequest): string => {
  return req.headers['x-real-ip'] as string || req.connection.remoteAddress || '';
};

export default withRateLimit(handler, getKeyFromIp, {
  timeframe: 3600,
  requestsLimit: 100,
  disableLRU: false,
  provider: 'upstash',
});
```

### Example with NextAuth
In this example, the key is generated using the authenticated user's ID from NextAuth.

```ts
import { withRateLimit } from 'next-api-rate-limit';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  // Your API logic here
  res.status(200).json({ message: 'Success' });
};

const getKeyFromNextAuth = async (req: NextApiRequest): Promise<string> => {
  const session = await getSession({ req });
  if (!session || !session.user || !session.user.id) {
    return '';
  }
  return session.user.id;
};

export default withRateLimit(handler, getKeyFromNextAuth, {
  timeframe: 3600,
  requestsLimit: 100,
  disableLRU: false,
  provider: 'upstash',
});
```

## How It Works
### LRU Cache
The LRU cache is used to store rate limit states temporarily. This reduces the number of calls to the Redis store, which helps in saving costs. The cache stores the remaining request count and the reset time for each unique key (e.g., IP address, user ID).

1. Key Extraction: The middleware extracts a unique key for the request, which could be an IP address, user ID, or other identifying information.
2. Cache Check: If the LRU cache is enabled, it checks if the rate limit state for the extracted key is present in the cache.
- If present and not expired, it updates the remaining count and proceeds with the request.
- If the remaining count is zero, it responds with a 429 Too Many Requests status.
3. Redis Check: If the rate limit state is not in the cache or the LRU cache is disabled, it fetches the rate limit state from the Redis store using Upstash or Vercel KV.
- If the rate limit is exceeded, it responds with a 429 Too Many Requests status.
- If not, it updates the LRU cache (if enabled) and proceeds with the request.
- If LRU is not enabled, it will proceed with the request without updating the cache.


