import fs from 'node:fs/promises';
await fs.mkdir('dist', { recursive: true });
await fs.cp('public', 'dist', { recursive: true });
await fs.cp('src', 'dist/src', { recursive: true });
console.log('Готово: dist/ — статический сайт для GitHub Pages.');
