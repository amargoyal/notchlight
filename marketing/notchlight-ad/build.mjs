import fs from 'node:fs/promises';
import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const parts = await Promise.all(['nl-theme.jsx','nl-faces.jsx','nl-desktop.jsx','film.jsx'].map(f=>fs.readFile(path.join(dir,'src',f),'utf8')));
await fs.mkdir(path.join(dir,'dist'),{recursive:true});
await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';\n${parts.join('\n')}`,resolveDir:dir,loader:'jsx'},bundle:true,minify:true,define:{'process.env.NODE_ENV':'"production"'},outfile:path.join(dir,'dist/film.js')});
console.log('Built Notchlight film.');
