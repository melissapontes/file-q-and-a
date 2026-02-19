const fs = require('fs');

const content = fs.readFileSync('c:/projetos/rag/file-q-and-a/supabase/functions/ask-document/index.ts', 'utf8');

const startMarker = "instructions: `";
let endMarkers = [
  "`,\r\n        model: 'gpt-4o',",
  "`,\n        model: 'gpt-4o',",
  "`,\n",
  "`,\r\n"
];

const startIdx = content.indexOf(startMarker);

if (startIdx === -1) {
  console.log('Could not find start marker');
  process.exit(1);
}

let endIdx = -1;
let foundEndMarker = '';
for (const marker of endMarkers) {
  endIdx = content.indexOf(marker, startIdx);
  if (endIdx !== -1) {
    foundEndMarker = marker;
    break;
  }
}

if (endIdx === -1) {
  console.log('Could not find end marker');
  // Try to find just the backtick-comma
  const searchFrom = startIdx + 100;
  const pattern = /`\s*,\s*model:/;
  const match = content.substring(searchFrom).match(pattern);
  if (match) {
    endIdx = searchFrom + match.index;
    console.log('Found alternative end at:', endIdx);
  } else {
    process.exit(1);
  }
}

console.log('Found end marker:', JSON.stringify(foundEndMarker));

const instructionsStart = startIdx + startMarker.length;
const instructionsText = content.substring(instructionsStart, endIdx);

console.log('=== INSTRUCTIONS TEXT ===');
console.log(instructionsText);
console.log('=== END ===');
console.log('\nLength:', instructionsText.length);
