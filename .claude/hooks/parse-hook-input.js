// Parses Claude Code hook JSON from stdin, outputs COMMAND and CWD for bash eval.
// Uses single quotes with proper escaping to prevent bash interpretation of special chars.
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const o = JSON.parse(d);
    const cmd = (o.tool_input && o.tool_input.command) || '';
    const cwd = o.cwd || '';
    // Single-quote values for bash safety: replace ' with '\'' (end quote, escaped quote, start quote)
    const esc = s => s.replace(/'/g, "'\\''");
    process.stdout.write("HOOK_COMMAND='" + esc(cmd) + "'\n");
    process.stdout.write("HOOK_CWD='" + esc(cwd) + "'\n");
  } catch (e) {
    process.stdout.write("HOOK_COMMAND=''\n");
    process.stdout.write("HOOK_CWD=''\n");
  }
});