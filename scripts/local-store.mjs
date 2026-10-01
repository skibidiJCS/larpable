import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// Preview only. Production always uses durable Redis storage.
export function localStore(file) {
  return {
    async run(accountId, action, addressHash, legacyId = '') {
      const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { members: [], rates: {} };
      data.accounts ||= {};
      data.claims ||= {};
      const members = new Set(data.members);
      let limited = false;
      if (action === 'join' && !Object.hasOwn(data.accounts, accountId)) {
        const now = Date.now();
        for (const [key, rate] of Object.entries(data.rates)) if (rate.until <= now) delete data.rates[key];
        const rate = data.rates[addressHash] || { count: 0, until: now + 60000 };
        rate.count += 1;
        data.rates[addressHash] = rate;
        limited = rate.count > 20;
        if (!limited) {
          let member = `account:${accountId}`;
          if (legacyId && members.has(legacyId) && !Object.hasOwn(data.claims, legacyId)) {
            member = legacyId;
            data.claims[legacyId] = accountId;
          } else {
            members.add(member);
          }
          data.accounts[accountId] = member;
          data.members = [...members];
        }
        writeFileSync(`${file}.tmp`, JSON.stringify(data));
        renameSync(`${file}.tmp`, file);
      }
      return { joined: Object.hasOwn(data.accounts, accountId), count: members.size, limited };
    },
  };
}
