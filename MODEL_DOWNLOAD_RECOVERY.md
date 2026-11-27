# V7.6 download recovery

Owner Samsung evidence is supplied data, not this environment's device run. Pinned HF API LFSmetadata and bounded206 GGUF probes independently match both manifests (docs/v3.2/v76/model-source-verification.json). Do not replace model or relax hashing.

Confirmed code defects: old downloader accepted bounded206 as completed then raised size mismatch; incompleteEOF could be mistaken for a completed install; lifecycle cancellation and generic disabled errors obscured prerequisites. These are demonstrated mechanisms, not proof of every phone failure. Shared downloader now continuesnumeric ContentRange segments, retains partials on networkerrors/cancellation, refreshes pinned redirects, validates ETag/IfRange, size/hash/magic. IgnoredRange with retainedpartial rejects explicitly instead of destroying bytes. Source metadata persists alongside SAF partial.13 real localHTTP tests pass; actual full2GB Samsung download notrun.
