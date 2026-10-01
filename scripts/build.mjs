import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public', { recursive: true });
for (const file of ['index.html', 'styles.css', 'script.js']) copyFileSync(file, `public/${file}`);
console.log('Public assets ready.');
