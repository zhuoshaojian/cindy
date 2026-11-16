// Ends a supervisor together with the application it launched. Background processes that the
// application starts can inherit its private pipe descriptors; waiting for end-of-file on those
// pipes would keep the supervisor, and with it the container, alive after the application exited.
export function exitWithChild(child, code, exit = process.exit) {
  for (const stream of child.stdio ?? []) stream?.destroy();
  exit(code);
}
