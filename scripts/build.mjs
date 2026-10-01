import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public', { recursive: true });
for (const file of ['index.html', 'styles.css', 'script.js', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
  copyFileSync(file, `public/${file}`);
}
console.log('Public assets ready.');
