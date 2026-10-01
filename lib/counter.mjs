// Membership and the total are checked/updated in a single Redis operation.
export const counterScript = `
local joined = redis.call('SISMEMBER', KEYS[1], ARGV[1])
if ARGV[2] == 'join' and joined == 0 then
  local attempts = redis.call('INCR', KEYS[2])
  if attempts == 1 then redis.call('EXPIRE', KEYS[2], 60) end
  if attempts > 20 then return {-1, redis.call('SCARD', KEYS[1])} end
  redis.call('SADD', KEYS[1], ARGV[1])
  joined = 1
end
return {joined, redis.call('SCARD', KEYS[1])}
`;

export function redisStore(url, token) {
  return {
    async run(visitorId, action, addressHash) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', counterScript, '2',
          'larpable:members', `larpable:rate:${addressHash}`, visitorId, action]),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || data.error || !Array.isArray(data.result)) {
        throw new Error('Counter storage unavailable');
      }
      const [state, count] = data.result;
      if (![-1, 0, 1].includes(state) || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('Invalid counter response');
      }
      return { joined: state === 1, count, limited: state === -1 };
    },
  };
}
