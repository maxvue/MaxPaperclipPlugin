# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.9] - 2026-09-30

### Fixed

- Fixed the task panel's “New task” action recapturing its own button instead of opening Paperclip's native creation modal.

## [1.1.8] - 2026-09-30

### Added

- Added an action to copy the conversation ID from each item in the chat session list, with visual confirmation.

### Changed

- Reordered the chat session hover metadata so action buttons appear before the date and time while keeping the timestamp visible.

### Fixed

- Fixed development and build task execution when resolving local project workspaces.
- Improved task-process lifecycle reconciliation and preserved complete execution logs.

## [1.1.7] - 2026-09-28

### Added

- Added explicit confirmation before executing repository-defined development or build tasks.
- Added multi-company regression coverage for process isolation, path confinement, log redaction, pagination, SVG sanitization, chat session grouping, and translation restoration.
- Added byte-based and line-based process log limits with automatic secret redaction.
- Added paginated loading for company issues and related-task discovery.

### Changed

- Moved task status and log operations to authenticated plugin actions scoped to the active company.
- Resolved project execution roots through the official primary workspace API instead of client-provided filesystem paths.
- Updated plugin capabilities to accurately declare issue, comment, project workspace, and state access.
- Updated local Paperclip SDK artifacts and made the build configuration portable across development machines.
- Changed bundled Paperclip dependencies to development-only dependencies so published packages remain installable.
- Changed chat session removal language and behavior to accurately represent browser-local hiding rather than server-side deletion.
- Replaced overlapping task and log polling intervals with completion-aware polling.
- Expanded planning leader selection to any eligible, invokable company agent instead of hard-coded identifiers.
- Limited task subprocesses to an explicit safe environment plus task-defined variables.

### Fixed

- Fixed cross-company process, status, and log collisions caused by keys that did not include the company identifier.
- Fixed arbitrary execution-root injection by rejecting client-supplied root directories.
- Fixed workspace traversal through task working directories and symbolic links outside the authorized project root.
- Fixed detached processes remaining alive after plugin shutdown.
- Fixed concurrent task start, stop, and toggle races by serializing operations per company, project, and task type.
- Fixed unbounded process logs and oversized log entries that could exhaust worker memory.
- Fixed false-positive auto-save success states and overly aggressive focus restoration.
- Fixed auto-save callbacks not being awaited, stale completions overriding newer edits, and saves targeting a newly focused field.
- Fixed stale translations overwriting application updates when translation was disabled.
- Fixed repeated canonical conversation generations being split into separate sessions.
- Fixed phantom empty chat sessions when the first canonical generation was not zero.
- Fixed partial cascade deletion from removing a parent after a child deletion failed.
- Fixed duplicate project loading caused by applying unsupported pagination parameters to the projects endpoint.
- Fixed linked tasks silently losing their parent relationship because an unsupported request field was used.
- Fixed hidden chat-session messages becoming visible when only one non-hidden session remained.
- Fixed stale task-sidebar requests updating the UI after switching companies.
- Fixed failed log-clearing requests being displayed as successful.
- Fixed POSIX shell task arguments losing quoting for whitespace and metacharacters.
- Fixed split output chunks bypassing secret redaction and final partial log lines being discarded.
- Fixed POSIX descendant process groups surviving after the main task process exited, added lifecycle reconciliation, and terminated active Windows task trees recursively.
- Fixed package exports, version metadata, dependency overrides, and release tarball installation.

### Security

- Sanitized remote and cached Iconify SVG content with strict element, attribute, URL, color, and size validation before DOM insertion.
- Restricted task execution to host-resolved project workspaces and validated real filesystem paths before reading task definitions or spawning processes.
- Scoped task process records and bridge actions to the authenticated company context.
- Redacted bearer tokens and common secret-bearing environment variables from retained process logs.
- Prevented worker-only secrets from being inherited by repository-defined subprocesses.
- Bounded the persistent Iconify cache by entry count and total size.

[Unreleased]: https://github.com/maxvue/MaxPaperclipPlugin/compare/v1.1.9...HEAD
[1.1.9]: https://github.com/maxvue/MaxPaperclipPlugin/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/maxvue/MaxPaperclipPlugin/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/maxvue/MaxPaperclipPlugin/releases/tag/v1.1.7
