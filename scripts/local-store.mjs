import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// Local preview only. Production always uses Redis, never serverless disk.
export function localStore(file) {
  return {
    async run(visitorId, action, addressHash) {
      const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { members: [], rates: {} };
      const members = new Set(data.members);
      let limited = false;
      if (action === 'join' && !members.has(visitorId)) {
        const now = Date.now();
        for (const [key, rate] of Object.entries(data.rates)) {
          if (rate.until <= now) delete data.rates[key];
        }
        const rate = data.rates[addressHash] || { count: 0, until: now + 60000 };
        rate.count += 1;
        data.rates[addressHash] = rate;
        limited = rate.count > 20;
        if (!limited) members.add(visitorId);
        data.members = [...members];
        writeFileSync(`${file}.tmp`, JSON.stringify(data));
        renameSync(`${file}.tmp`, file);
      }
      return { joined: members.has(visitorId), count: members.size, limited };
    },
  };
}
