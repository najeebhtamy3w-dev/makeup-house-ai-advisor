# V7.6 persistent model storage

SSOT: docs/v3.2/v76/state.json. Manager selects ACTION_OPEN_DOCUMENT_TREE with persisted scoped grants perasset. Permanent originals remain in selected SAF folder. Downloads stream to seekable document FD via /proc/self/fd while held; nonseekable providers reject explicitly. Native runtime uses a separately verified private copy; no direct-SAF mmap acceptance is claimed. Internal cache removal retains permanent originals/partials. Reconnect scans by pinned size/hash/GGUF, never filename/sidecar authority. Reinstallation requires granting tree again.

Local file import/export and partialprefix metadata are implemented. Old app private data cannot be read by another signing identity. Dev7key was notfound; no destructive transition executed or requested. Background service, Androidprovider lifecycle and uninstall/reinstall + actual airplane inference remain NOT TESTED/PARTIAL; Gate05 is notPASS.
