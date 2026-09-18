// Reads the INPUT workflow document for `validate`, `check` and `render`:
// from a file path, or from stdin when the path is "-".
//
// Why stdin exists (issue #31): a host may grant the CLI narrowly -- this
// plugin's own CI grants only `Bash(node:*)`, with no file-writing tool --
// and then the only way to get a map document onto disk for `check` and
// `render` was `node -e "fs.writeFileSync(...)"` with the whole document
// inlined in a shell string. Whether an agent found that path was luck.
// With "-" the document is piped straight in (`printf '%s' '<json>' | node
// ...` keeps the command starting with `node`; a narrow grant refuses a JSON
// heredoc), and no file has to be materialised.
//
// "-" is only ever the INPUT document. Output paths and `--evidence` stay
// real files; each subcommand rejects "-" there itself.
//
// Both sources are bounded by the same cap, MAX_DOCUMENT_BYTES, and fail
// loudly past it. The file path is checked by fstat before a byte is read;
// stdin is counted chunk by chunk and torn down the moment the cap is
// crossed, so neither path ever buffers an unbounded input.

const fs = require('fs');

const STDIN_PATH = '-';
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024; // 16MB: an artifact page's own limit
const MAX_DOCUMENT_LABEL = `${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB`;

function tooLarge(source) {
  return new Error(`${source} exceeds the ${MAX_DOCUMENT_LABEL} document limit; nothing was read.`);
}

function readDocumentFile(filePath) {
  // Open first so a missing file still reports the familiar
  // "ENOENT: no such file or directory, open '<path>'" line, then size the
  // open descriptor before reading a byte of it.
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`${filePath} is not a regular file (use "-" to read the document from stdin).`);
    }
    if (stat.size > MAX_DOCUMENT_BYTES) throw tooLarge(filePath);
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readDocumentStdin(stdin) {
  return new Promise((resolve, reject) => {
    if (stdin.isTTY) {
      reject(new Error('stdin is a terminal; pipe the document in when the input path is "-".'));
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    const settle = fn => {
      if (settled) return;
      settled = true;
      fn();
    };
    stdin.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_DOCUMENT_BYTES) {
        stdin.destroy();
        settle(() => reject(tooLarge('stdin')));
        return;
      }
      chunks.push(buf);
    });
    stdin.on('end', () => settle(() => resolve(Buffer.concat(chunks).toString('utf8'))));
    stdin.on('error', err => settle(() => reject(err)));
  });
}

// Returns the parsed document. Throws (with a one-line message the caller
// prints to stderr) on a missing or oversized file, an oversized or
// terminal stdin, or malformed JSON -- the JSON error is the same for
// both sources.
async function readDocument(inputPath, stdin = process.stdin) {
  const text = inputPath === STDIN_PATH ? await readDocumentStdin(stdin) : readDocumentFile(inputPath);
  return JSON.parse(text);
}

module.exports = { readDocument, STDIN_PATH, MAX_DOCUMENT_BYTES };
