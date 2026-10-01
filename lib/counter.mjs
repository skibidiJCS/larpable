// Account linking and membership updates are one atomic Redis operation.
export const counterScript = `
local member = redis.call('HGET', KEYS[3], ARGV[1])
local joined = 0
if member then joined = 1 end
if ARGV[2] == 'join' and joined == 0 then
  local attempts = redis.call('INCR', KEYS[2])
  if attempts == 1 then redis.call('EXPIRE', KEYS[2], 60) end
  if attempts > 20 then return {-1, redis.call('SCARD', KEYS[1])} end
  member = 'account:' .. ARGV[1]
  if ARGV[3] ~= '' and redis.call('SISMEMBER', KEYS[1], ARGV[3]) == 1
    and redis.call('HEXISTS', KEYS[4], ARGV[3]) == 0 then
    member = ARGV[3]
    redis.call('HSET', KEYS[4], ARGV[3], ARGV[1])
  else
    redis.call('SADD', KEYS[1], member)
  end
  redis.call('HSET', KEYS[3], ARGV[1], member)
  joined = 1
end
return {joined, redis.call('SCARD', KEYS[1])}
`;

export function redisStore(url, token) {
  return {
    async run(accountId, action, addressHash, legacyId = '') {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', counterScript, '4',
          'larpable:members', `larpable:rate:${addressHash}`,
          'larpable:accounts', 'larpable:legacy-claims', accountId, action, legacyId]),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || data.error || !Array.isArray(data.result)) throw new Error('Counter storage unavailable');
      const [state, count] = data.result;
      if (![-1, 0, 1].includes(state) || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid counter response');
      return { joined: state === 1, count, limited: state === -1 };
    },
  };
}
