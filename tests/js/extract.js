// Extract the `const data = {...}` object from a generated visualizer HTML
// using brace balancing (string/escape aware).
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const marker = 'const data = ';
const start = html.indexOf(marker) + marker.length;
let depth = 0, inStr = false, esc = false, end = -1;
for (let i = start; i < html.length; i++) {
  const ch = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (ch === '\\') esc = true;
    else if (ch === '"') inStr = false;
    continue;
  }
  if (ch === '"') { inStr = true; depth = Math.max(depth, 1); continue; }
  // only track braces once inside the object (first non-ws char must be '{')
  if (depth === 0) {
    if (/\s/.test(ch)) continue;
    if (ch !== '{') { console.error('data does not start with {'); process.exit(1); }
    depth = 1;
    continue;
  }
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end < 0) { console.error('no closing brace'); process.exit(1); }
const json = html.slice(start, end);
JSON.parse(json); // validate
fs.writeFileSync(process.argv[3], json);
console.log(`extracted ${json.length} chars -> ${process.argv[3]}`);
